// src/controllers/predictionController.js
const predictionService = require('../services/predictionService');
const db = require('../../config/db');

// 1. PRÉDICTION POUR L'HÔPITAL CONNECTÉ
// GET /api/predictions/stock
exports.getPredictionHopital = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    if (!id_hopital) {
        return res.status(403).json({ message: "Cette fonctionnalité est réservée aux comptes hospitaliers." });
    }

    try {
        const predictions = await predictionService.predireStockHopital(id_hopital);
        res.status(200).json({
            seuils: {
                rupture_jours: predictionService.SEUIL_RUPTURE_JOURS,
                peremption_jours: predictionService.SEUIL_PEREMPTION_JOURS
            },
            predictions
        });
    } catch (error) {
        console.error("Erreur prédiction hôpital :", error);
        res.status(500).json({ message: "Erreur lors du calcul des prédictions." });
    }
};

// 2. VUE RÉSEAU CONSOLIDÉE, AVEC SUGGESTIONS DE TRANSFERT (Admin uniquement)
// GET /api/predictions/reseau?region=TOUTES|<nom_region>
exports.getPredictionReseau = async (req, res) => {
    const { region } = req.query;
    const filtreRegion = region && region !== 'TOUTES';

    try {
        let hopitauxQuery = `SELECT id_hopital, nom, region FROM medical_logistics.hopitaux WHERE statut = 'ACTIF'`;
        const params = [];
        if (filtreRegion) {
            params.push(region);
            hopitauxQuery += ` AND region = $1`;
        }
        const hopitauxResult = await db.query(hopitauxQuery, params);

        // OPTIMISATION : Calculs exécutés en parallèle via Promise.all
        const predictionsParHopital = await Promise.all(
            hopitauxResult.rows.map(async (hopital) => {
                const predictions = await predictionService.predireStockHopital(hopital.id_hopital);
                return {
                    id_hopital: hopital.id_hopital,
                    nom_hopital: hopital.nom,
                    region: hopital.region,
                    predictions
                };
            })
        );

        // Matching pour suggestions de transfert
        const suggestions = [];
        for (const source of predictionsParHopital) {
            for (const predSource of source.predictions) {
                if (predSource.poches_a_risque.length === 0) continue;

                for (const cible of predictionsParHopital) {
                    if (cible.id_hopital === source.id_hopital) continue;

                    const predCible = cible.predictions.find(p => p.groupe_sanguin === predSource.groupe_sanguin);
                    if (predCible && predCible.statut === 'RUPTURE_IMMINENTE') {
                        suggestions.push({
                            groupe_sanguin: predSource.groupe_sanguin,
                            hopital_source: { id: source.id_hopital, nom: source.nom_hopital },
                            hopital_cible: { id: cible.id_hopital, nom: cible.nom_hopital },
                            poches_disponibles_a_transferer: predSource.poches_a_risque.length,
                            jours_avant_perte: Math.min(...predSource.poches_a_risque.map(p => p.jours_restants)),
                            jours_avant_rupture_cible: predCible.jours_avant_rupture
                        });
                    }
                }
            }
        }

        suggestions.sort((a, b) => a.jours_avant_perte - b.jours_avant_perte);

        res.status(200).json({
            seuils: {
                rupture_jours: predictionService.SEUIL_RUPTURE_JOURS,
                peremption_jours: predictionService.SEUIL_PEREMPTION_JOURS
            },
            hopitaux: predictionsParHopital,
            suggestions_transfert: suggestions
        });

    } catch (error) {
        console.error("Erreur prédiction réseau :", error);
        res.status(500).json({ message: "Erreur lors du calcul des prédictions réseau." });
    }
};

// 3. CONSULTER SES ALERTES (hôpital connecté)
// GET /api/predictions/alertes
exports.getAlertesHopital = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    if (!id_hopital) {
        return res.status(200).json([]);
    }

    try {
        const result = await db.query(
            `SELECT id_alerte, type_alerte, groupe_sanguin, message, jours_estimes, lue_hopital, date_creation
             FROM medical_logistics.alertes
             WHERE id_hopital = $1
             ORDER BY date_creation DESC
             LIMIT 50;`,
            [id_hopital]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération alertes :", error);
        res.status(500).json({ message: "Erreur lors du chargement des alertes." });
    }
};

// 4. MARQUER UNE ALERTE COMME LUE
// PATCH /api/predictions/alertes/:id_alerte/lue
exports.marquerAlerteLue = async (req, res) => {
    const { id_alerte } = req.params;
    const id_hopital = req.user.id_hopital;
    const estAdmin = req.user.role === 'SUPER_ADMIN';

    try {
        const champLu = estAdmin ? 'lue_admin' : 'lue_hopital';
        const condition = estAdmin ? '' : 'AND id_hopital = $2';
        const params = estAdmin ? [id_alerte] : [id_alerte, id_hopital];

        const result = await db.query(
            `UPDATE medical_logistics.alertes SET ${champLu} = true 
             WHERE id_alerte = $1 ${condition}
             RETURNING id_alerte;`,
            params
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Alerte introuvable." });
        }

        res.status(200).json({ message: "Alerte marquée comme lue." });
    } catch (error) {
        console.error("Erreur marquage alerte :", error);
        res.status(500).json({ message: "Erreur lors du marquage de l'alerte." });
    }
};

// 5. CONSULTER TOUTES LES ALERTES DU RÉSEAU (Admin uniquement)
// GET /api/predictions/alertes/reseau
exports.getAlertesReseau = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT a.id_alerte, a.type_alerte, a.groupe_sanguin, a.message, 
                    a.jours_estimes, a.lue_admin, a.date_creation,
                    h.nom AS nom_hopital, h.region
             FROM medical_logistics.alertes a
             JOIN medical_logistics.hopitaux h ON a.id_hopital = h.id_hopital
             ORDER BY a.date_creation DESC
             LIMIT 100;`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération alertes réseau :", error);
        res.status(500).json({ message: "Erreur lors du chargement des alertes réseau." });
    }
};
