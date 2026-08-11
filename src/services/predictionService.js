// src/services/predictionService.js
//
// Module de prédiction — deux volets complémentaires, décidés ensemble :
//   1. Prédiction de RUPTURE de stock (régression linéaire sur la
//      consommation historique par groupe sanguin)
//   2. Prédiction de PERTE PAR PÉREMPTION (poches déjà en stock dont la
//      date d'expiration approche, sans qu'elles soient consommées à temps)
//
// Approche "Option C" actée : régression linéaire simple, écrite à la main
// (aucune dépendance externe de machine learning), suffisante pour ce
// cas d'usage et sans coût ni dépendance réseau.
//
// Seuils actés : rupture signalée sous 5 jours, péremption à risque sous
// 7 jours.

const db = require('../../config/db');

const SEUIL_RUPTURE_JOURS = 5;
const SEUIL_PEREMPTION_JOURS = 7;
const FENETRE_HISTORIQUE_JOURS = 21; // fenêtre retenue pour la régression : voir justification ci-dessous

/**
 * Régression linéaire simple (méthode des moindres carrés).
 * points = [{x: nombre_de_jours_écoulés, y: stock_disponible_ce_jour_là}, ...]
 * Renvoie {a, b} tels que y = a*x + b (a = pente, b = ordonnée à l'origine).
 */
function regressionLineaire(points) {
    const n = points.length;
    if (n < 2) return null; // pas assez de données pour une tendance fiable

    const sommeX = points.reduce((s, p) => s + p.x, 0);
    const sommeY = points.reduce((s, p) => s + p.y, 0);
    const sommeXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sommeX2 = points.reduce((s, p) => s + p.x * p.x, 0);

    const denominateur = (n * sommeX2 - sommeX * sommeX);
    if (denominateur === 0) return null; // tous les points ont le même x, régression impossible

    const a = (n * sommeXY - sommeX * sommeY) / denominateur;
    const b = (sommeY - a * sommeX) / n;

    return { a, b };
}

/**
 * Reconstitue la série temporelle du stock disponible jour par jour, pour
 * un hôpital et un groupe sanguin donnés, à partir des mouvements
 * d'entrée/sortie sur la fenêtre d'historique retenue.
 */
async function construireSerieStock(id_hopital, groupe_sanguin) {
    const result = await db.query(
        `SELECT date_mouvement, type_mouvement, quantite_poches
         FROM medical_logistics.historique_mouvements
         WHERE id_hopital = $1 AND groupe_sanguin = $2
           AND date_mouvement >= NOW() - INTERVAL '${FENETRE_HISTORIQUE_JOURS} days'
         ORDER BY date_mouvement ASC;`,
        [id_hopital, groupe_sanguin]
    );

    // Stock actuel réel (source de vérité), pour ancrer la reconstitution
    const stockActuelResult = await db.query(
        `SELECT COUNT(*)::INTEGER AS total
         FROM medical_logistics.poches_sang
         WHERE id_hopital = $1 AND groupe_sanguin = $2
           AND statut = 'DISPONIBLE' AND date_peremption >= CURRENT_DATE;`,
        [id_hopital, groupe_sanguin]
    );
    const stockActuel = stockActuelResult.rows[0].total;

    if (result.rows.length === 0) {
        return { points: [], stockActuel };
    }

    // Reconstitution rétroactive : on part du stock actuel et on "remonte"
    // le temps en défaisant chaque mouvement, pour obtenir le niveau de
    // stock à la fin de chaque jour de la fenêtre d'historique.
    const mouvementsInverses = [...result.rows].reverse();
    let stockCourant = stockActuel;
    const pointsParDate = new Map();

    const aujourdHui = new Date();
    pointsParDate.set(aujourdHui.toISOString().slice(0, 10), stockCourant);

    for (const mvt of mouvementsInverses) {
        // Défaire le mouvement : une ENTREE passée signifie que le stock
        // était plus bas avant elle ; une SORTIE passée signifie qu'il était
        // plus haut avant elle.
        if (mvt.type_mouvement === 'ENTREE') {
            stockCourant -= mvt.quantite_poches;
        } else {
            stockCourant += mvt.quantite_poches;
        }
        const dateKey = new Date(mvt.date_mouvement).toISOString().slice(0, 10);
        pointsParDate.set(dateKey, Math.max(stockCourant, 0));
    }

    // Convertit en points {x, y} avec x = nombre de jours avant aujourd'hui (négatif dans le passé)
    const points = Array.from(pointsParDate.entries()).map(([dateStr, stock]) => {
        const joursEcart = Math.round((new Date(dateStr) - aujourdHui) / (1000 * 3600 * 24));
        return { x: joursEcart, y: stock };
    }).sort((a, b) => a.x - b.x);

    return { points, stockActuel };
}

/**
 * Calcule la prédiction de rupture pour un hôpital et un groupe sanguin.
 */
async function predireRupture(id_hopital, groupe_sanguin) {
    const { points, stockActuel } = await construireSerieStock(id_hopital, groupe_sanguin);

    if (points.length < 2) {
        return {
            groupe_sanguin,
            stock_actuel: stockActuel,
            jours_avant_rupture: null,
            statut: stockActuel === 0 ? 'RUPTURE_IMMINENTE' : 'DONNEES_INSUFFISANTES',
            fiabilite: 'faible'
        };
    }

    const reg = regressionLineaire(points);
    if (!reg || reg.a >= 0) {
        // Pente nulle ou positive : le stock ne diminue pas (ou augmente) au
        // rythme observé, donc pas de rupture prévisible sur cette tendance.
        return {
            groupe_sanguin,
            stock_actuel: stockActuel,
            jours_avant_rupture: null,
            statut: stockActuel === 0 ? 'RUPTURE_IMMINENTE' : 'STABLE',
            fiabilite: 'moyenne'
        };
    }

    // Résoudre y = a*x + b = 0 → x = -b/a, en partant de x=0 (aujourd'hui)
    const joursAvantRupture = Math.max(Math.round(-reg.b / reg.a), 0);

    return {
        groupe_sanguin,
        stock_actuel: stockActuel,
        jours_avant_rupture: joursAvantRupture,
        statut: joursAvantRupture <= SEUIL_RUPTURE_JOURS ? 'RUPTURE_IMMINENTE' : 'STABLE',
        fiabilite: points.length >= 5 ? 'bonne' : 'moyenne'
    };
}

/**
 * Identifie les poches disponibles proches de la péremption pour un
 * hôpital et un groupe sanguin, susceptibles d'être perdues si non
 * utilisées ni transférées à temps.
 */
async function identifierSurplusARisque(id_hopital, groupe_sanguin) {
    const result = await db.query(
        `SELECT id_poche, composant, date_peremption,
                (date_peremption - CURRENT_DATE) AS jours_restants
         FROM medical_logistics.poches_sang
         WHERE id_hopital = $1 AND groupe_sanguin = $2
           AND statut = 'DISPONIBLE'
           AND date_peremption >= CURRENT_DATE
           AND date_peremption <= CURRENT_DATE + INTERVAL '${SEUIL_PEREMPTION_JOURS} days'
         ORDER BY date_peremption ASC;`,
        [id_hopital, groupe_sanguin]
    );

    return result.rows.map(r => ({
        id_poche: r.id_poche,
        composant: r.composant,
        date_peremption: r.date_peremption,
        jours_restants: r.jours_restants
    }));
}

/**
 * Prédiction complète pour un hôpital : rupture + surplus à risque, pour
 * chaque groupe sanguin réellement présent dans son stock ou son historique.
 */
async function predireStockHopital(id_hopital) {
    const groupesResult = await db.query(
        `SELECT DISTINCT groupe_sanguin FROM medical_logistics.poches_sang WHERE id_hopital = $1
         UNION
         SELECT DISTINCT groupe_sanguin FROM medical_logistics.historique_mouvements WHERE id_hopital = $1;`,
        [id_hopital]
    );

    const predictions = [];
    for (const row of groupesResult.rows) {
        const groupe = row.groupe_sanguin;
        const [rupture, surplus] = await Promise.all([
            predireRupture(id_hopital, groupe),
            identifierSurplusARisque(id_hopital, groupe)
        ]);

        let statutGlobal = rupture.statut;
        if (surplus.length > 0) {
            statutGlobal = statutGlobal === 'RUPTURE_IMMINENTE' ? 'RUPTURE_IMMINENTE' : 'SURPLUS_A_RISQUE';
        }

        predictions.push({
            ...rupture,
            statut: statutGlobal,
            poches_a_risque: surplus
        });
    }

    return predictions;
}

module.exports = {
    predireStockHopital,
    predireRupture,
    identifierSurplusARisque,
    SEUIL_RUPTURE_JOURS,
    SEUIL_PEREMPTION_JOURS
};
