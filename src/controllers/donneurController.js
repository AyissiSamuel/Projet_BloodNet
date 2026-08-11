// src/controllers/donneurController.js
const db = require('../../config/db');

// Durée de conservation par défaut pour une poche issue d'un don (sang total).
// Alignée sur la logique déjà appliquée dans pochesController.js.
const DUREE_CONSERVATION_JOURS = 42;

// 1. Enregistrer un nouveau donneur (étape indépendante, conservée pour
// les cas où le personnel veut créer une fiche donneur sans don immédiat).
exports.registerDonneur = async (req, res) => {
    const { nom, telephone, email, groupe_sanguin, date_dernier_don, est_anonyme } = req.body;

    // Un donneur anonyme peut ne pas fournir son nom : on utilise un nom
    // générique dans ce cas plutôt que de bloquer l'enregistrement.
    const nomFinal = est_anonyme ? (nom || 'Donneur anonyme') : nom;

    if (!est_anonyme && !nom) {
        return res.status(400).json({ message: "Le nom est requis pour un donneur non anonyme." });
    }
    if (!telephone || !groupe_sanguin) {
        return res.status(400).json({ message: "Le téléphone et le groupe sanguin sont requis." });
    }

    try {
        const queryText = `
            INSERT INTO medical_logistics.donneurs (nom, telephone, email, groupe_sanguin, date_dernier_don, est_anonyme)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;

        const values = [
            nomFinal,
            telephone,
            email || null,
            groupe_sanguin.toUpperCase(),
            date_dernier_don || null,
            est_anonyme || false
        ];
        const result = await db.query(queryText, values);

        res.status(201).json({
            message: "Donneur enregistré avec succès.",
            donneur: result.rows[0]
        });
    } catch (error) {
        console.error("Erreur Enregistrement Donneur :", error);

        if (error.code === '23505') {
            return res.status(400).json({ message: "Un donneur avec ce numéro de téléphone ou cet email existe déjà." });
        }
        if (error.code === '23514' && error.constraint === 'chk_donneur_groupe') {
            return res.status(400).json({ message: "Groupe sanguin invalide. Valeurs autorisées : A+, A-, B+, B-, AB+, AB-, O+, O-." });
        }

        res.status(500).json({ message: "Erreur lors de l'enregistrement du donneur." });
    }
};

// 2. Rechercher des donneurs éligibles par groupe sanguin (Urgence)
exports.searchDonneurs = async (req, res) => {
    const { groupe_sanguin } = req.query;

    try {
        let queryText = `
            SELECT id_donneur, nom, telephone, email, groupe_sanguin, date_dernier_don, est_anonyme 
            FROM medical_logistics.donneurs WHERE statut_eligibilite = true
        `;
        const params = [];

        if (groupe_sanguin) {
            params.push(groupe_sanguin.toUpperCase());
            queryText += ` AND groupe_sanguin = $1`;
        }

        const result = await db.query(queryText, params);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur Recherche Donneurs :", error);
        res.status(500).json({ message: "Impossible de rechercher les donneurs." });
    }
};

// 3. Liste complète des donneurs (attendue par le frontend : GET /api/donneurs)
//
// Alignée sur les champs réellement consommés par public/js/modules/donors.js :
// code_donneur (dérivé de l'UUID, car aucune colonne dédiée n'existe),
// nom_complet (alias de la colonne réelle "nom"), total_dons et dernier_don
// calculés depuis historique_dons plutôt que stockés en dur sur donneurs.
exports.getAllDonneurs = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT 
                d.id_donneur,
                CONCAT('DON-', UPPER(SUBSTRING(d.id_donneur::text, 1, 6))) AS code_donneur,
                d.nom AS nom_complet,
                d.telephone,
                d.email,
                d.groupe_sanguin,
                d.est_anonyme,
                d.statut_eligibilite,
                COALESCE(hist.total_dons, 0) AS total_dons,
                hist.dernier_don
             FROM medical_logistics.donneurs d
             LEFT JOIN (
                SELECT id_donneur, COUNT(*) AS total_dons, MAX(date_don) AS dernier_don
                FROM medical_logistics.historique_dons
                GROUP BY id_donneur
             ) hist ON hist.id_donneur = d.id_donneur
             ORDER BY hist.dernier_don DESC NULLS LAST;`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération liste donneurs :", error);
        res.status(500).json({ message: "Impossible de récupérer la liste des donneurs." });
    }
};

// 4. ENREGISTRER UN DONNEUR ET SON DON EN UNE SEULE REQUÊTE
//
// Fusion des anciennes étapes registerDonneur + registrarDon, conformément
// au flux attendu par le frontend (public/js/modules/donors.js), qui
// soumet un formulaire unique "nouveau don" plutôt que deux formulaires
// séparés. Gère aussi l'option "don anonyme".
//
// Le don se traduit par la création d'une POCHE INDIVIDUELLE dans
// medical_logistics.poches_sang (gestion poche par poche actée), et non
// plus par l'incrémentation d'un compteur agrégé dans une table "stocks"
// séparée — ce qui supprimait la double source de vérité identifiée en
// phase d'analyse.
exports.enregistrerDonEtDonneur = async (req, res) => {
    const {
        id_donneur,       // optionnel : si fourni, réutilise un donneur existant
        nom_complet,
        telephone,
        email,
        groupe_sanguin,
        est_anonyme,
        volume_ml,
        remarques
    } = req.body;

    const id_hopital = req.user.id_hopital;

    if (!groupe_sanguin) {
        return res.status(400).json({ message: "Le groupe sanguin est requis." });
    }
    if (!est_anonyme && !id_donneur && !nom_complet) {
        return res.status(400).json({ message: "Le nom du donneur est requis (sauf don anonyme)." });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        let donneurId = id_donneur;

        // Si aucun donneur existant n'est référencé, on en crée un nouveau
        if (!donneurId) {
            const nomFinal = est_anonyme ? (nom_complet || 'Donneur anonyme') : nom_complet;
            // donneurs.telephone est NOT NULL et UNIQUE en base (contraintes
            // réelles du schéma) : un don anonyme sans téléphone fourni
            // utilise un identifiant généré unique plutôt qu'une valeur
            // littérale fixe, qui violerait l'unicité dès le 2e don anonyme.
            const telephoneFinal = telephone || (est_anonyme ? `ANONYME-${Date.now()}` : null);
            if (!telephoneFinal) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: "Le téléphone est requis (sauf don anonyme)." });
            }
            const donneurInsert = await client.query(
                `INSERT INTO medical_logistics.donneurs (nom, telephone, email, groupe_sanguin, est_anonyme)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id_donneur`,
                [nomFinal, telephoneFinal, email || null, groupe_sanguin.toUpperCase(), est_anonyme || false]
            );
            donneurId = donneurInsert.rows[0].id_donneur;
        } else {
            // Vérification d'éligibilité : 8 semaines (56 jours) depuis le dernier don
            const dernierDonCheck = await client.query(
                `SELECT date_don FROM medical_logistics.historique_dons 
                 WHERE id_donneur = $1 ORDER BY date_don DESC LIMIT 1`,
                [donneurId]
            );

            if (dernierDonCheck.rows.length > 0) {
                const joursDepuisDernierDon = Math.floor(
                    (Date.now() - new Date(dernierDonCheck.rows[0].date_don).getTime()) / (1000 * 3600 * 24)
                );
                if (joursDepuisDernierDon < 56) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        message: `Ce donneur n'est pas encore éligible (dernier don il y a ${joursDepuisDernierDon} jours, minimum 56 jours).`,
                        jours_restants: 56 - joursDepuisDernierDon
                    });
                }
            }
        }

        // Enregistrer le don dans l'historique
        const nouveauDon = await client.query(
            `INSERT INTO medical_logistics.historique_dons (id_donneur, id_hopital_prelevement, volume_ml, remarques)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [donneurId, id_hopital, volume_ml || 450, remarques || null]
        );

        // Créer la poche individuelle correspondante (gestion poche par poche)
        const datePeremption = new Date();
        datePeremption.setDate(datePeremption.getDate() + DUREE_CONSERVATION_JOURS);

        const nouvellePoche = await client.query(
            `INSERT INTO medical_logistics.poches_sang 
                (id_hopital, groupe_sanguin, composant, volume_ml, date_collecte, date_peremption, statut)
             VALUES ($1, $2, 'SANG_TOTAL', $3, CURRENT_DATE, $4, 'DISPONIBLE')
             RETURNING *`,
            [id_hopital, groupe_sanguin.toUpperCase(), volume_ml || 450, datePeremption]
        );

        await client.query('COMMIT');

        res.status(201).json({
            message: "Don enregistré avec succès. Une nouvelle poche a été ajoutée au stock.",
            don: nouveauDon.rows[0],
            poche: nouvellePoche.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur enregistrement don :", error);
        res.status(500).json({ message: "Erreur interne lors de la validation du don." });
    } finally {
        client.release();
    }
};

// 5. Historique d'un donneur précis
exports.getHistoriqueDonneur = async (req, res) => {
    const { id_donneur } = req.params;

    try {
        const result = await db.query(
            `SELECT h.*, hop.nom as nom_hopital 
             FROM medical_logistics.historique_dons h
             JOIN medical_logistics.hopitaux hop ON h.id_hopital_prelevement = hop.id_hopital
             WHERE h.id_donneur = $1
             ORDER BY h.date_don DESC`,
            [id_donneur]
        );

        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération historique :", error);
        res.status(500).json({ message: "Impossible de récupérer l'historique du donneur." });
    }
};

// 6. Historique global des dons (attendu par le frontend : GET /api/donneurs/historique-dons)
//
// Alignée sur les champs consommés par public/js/modules/donors.js :
// code_donneur (dérivé de l'UUID donneur), groupe_sanguin (récupéré depuis
// donneurs, absent de historique_dons), lieu_prelevement (alias du nom
// d'hôpital). statut_serologique n'existe dans aucune table du schéma réel :
// affiché en dur côté frontend via un fallback ("CONFORME" par défaut), non
// modélisé côté base pour l'instant.
exports.getHistoriqueGlobal = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT 
                h.id_don,
                h.date_don,
                h.volume_ml,
                h.remarques,
                CONCAT('DON-', UPPER(SUBSTRING(d.id_donneur::text, 1, 6))) AS code_donneur,
                d.nom AS nom_donneur,
                d.est_anonyme,
                d.groupe_sanguin,
                hop.nom AS lieu_prelevement
             FROM medical_logistics.historique_dons h
             JOIN medical_logistics.donneurs d ON h.id_donneur = d.id_donneur
             JOIN medical_logistics.hopitaux hop ON h.id_hopital_prelevement = hop.id_hopital
             ORDER BY h.date_don DESC
             LIMIT 100;`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération historique global :", error);
        res.status(500).json({ message: "Impossible de récupérer l'historique global des dons." });
    }
};
