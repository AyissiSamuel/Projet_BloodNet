// src/controllers/supervisionController.js
//
// Module de Supervision régionale — développé pour répondre au frontend
// existant (public/js/modules/admin-supervision.js), qui anticipait cette
// fonctionnalité sans backend correspondant. Permet à l'Admin (SUPER_ADMIN)
// de consulter le stock consolidé par région et d'auditer le détail du
// stock d'un hôpital précis.

const db = require('../../config/db');

// GET /api/admin/supervision?region=TOUTES|<nom_region>
exports.getSupervisionRegionale = async (req, res) => {
    const { region } = req.query;
    const filtreRegion = region && region !== 'TOUTES';

    try {
        // 1. Stock consolidé par groupe sanguin, sur la région sélectionnée
        // (ou sur l'ensemble du réseau si 'TOUTES').
        let stockQuery = `
            SELECT p.groupe_sanguin, COUNT(*) AS total
            FROM medical_logistics.poches_sang p
            JOIN medical_logistics.hopitaux h ON p.id_hopital = h.id_hopital
            WHERE p.statut = 'DISPONIBLE' AND p.date_peremption >= CURRENT_DATE
        `;
        const stockParams = [];
        if (filtreRegion) {
            stockParams.push(region);
            stockQuery += ` AND h.region = $1`;
        }
        stockQuery += ` GROUP BY p.groupe_sanguin;`;

        const stockResult = await db.query(stockQuery, stockParams);

        // Transforme le résultat en objet { 'O+': 45, 'O-': 5, ... } attendu par le frontend
        const consolidatedStock = {};
        stockResult.rows.forEach(row => {
            consolidatedStock[row.groupe_sanguin] = parseInt(row.total, 10);
        });

        // 2. Liste des hôpitaux de la région, avec leur stock total et dernière activité
        let hopitauxQuery = `
            SELECT 
                h.id_hopital,
                h.nom AS nom_hopital,
                h.region,
                h.telephone,
                h.statut AS statut_validation,
                COALESCE(stock.total_stock, 0) AS total_stock,
                activite.derniere_activite
            FROM medical_logistics.hopitaux h
            LEFT JOIN (
                SELECT id_hopital, COUNT(*) AS total_stock
                FROM medical_logistics.poches_sang
                WHERE statut = 'DISPONIBLE' AND date_peremption >= CURRENT_DATE
                GROUP BY id_hopital
            ) stock ON stock.id_hopital = h.id_hopital
            LEFT JOIN (
                SELECT id_hopital, MAX(date_collecte) AS derniere_activite
                FROM medical_logistics.poches_sang
                GROUP BY id_hopital
            ) activite ON activite.id_hopital = h.id_hopital
        `;
        const hopitauxParams = [];
        if (filtreRegion) {
            hopitauxParams.push(region);
            hopitauxQuery += ` WHERE h.region = $1`;
        }
        hopitauxQuery += ` ORDER BY h.nom ASC;`;

        const hopitauxResult = await db.query(hopitauxQuery, hopitauxParams);

        res.status(200).json({
            consolidatedStock,
            hospitals: hopitauxResult.rows
        });

    } catch (error) {
        console.error("Erreur supervision régionale :", error);
        res.status(500).json({ message: "Erreur lors du chargement des données de supervision." });
    }
};

// GET /api/admin/hopital/:id/stock — détail du stock d'un hôpital précis (audit)
exports.getStockHopital = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.query(
            `SELECT groupe_sanguin, COUNT(*) AS quantite
             FROM medical_logistics.poches_sang
             WHERE id_hopital = $1 AND statut = 'DISPONIBLE' AND date_peremption >= CURRENT_DATE
             GROUP BY groupe_sanguin
             ORDER BY groupe_sanguin ASC;`,
            [id]
        );

        const stockDetails = result.rows.map(row => ({
            groupe_sanguin: row.groupe_sanguin,
            quantite: parseInt(row.quantite, 10)
        }));

        res.status(200).json(stockDetails);
    } catch (error) {
        console.error("Erreur audit stock hôpital :", error);
        res.status(500).json({ message: "Erreur lors de la récupération du stock de l'hôpital." });
    }
};

// GET /api/admin/hopitaux/activite?region=TOUTES|<nom_region>
//
// Vue dédiée "Hôpitaux par zone" (distincte de la supervision orientée
// stock ci-dessus) : indicateurs d'activité générale par établissement —
// nombre de dons enregistrés, commandes passées/reçues, dernière activité
// toutes catégories confondues, sur les 30 derniers jours.
exports.getActiviteHopitaux = async (req, res) => {
    const { region } = req.query;
    const filtreRegion = region && region !== 'TOUTES';

    try {
        let query = `
            SELECT 
                h.id_hopital,
                h.nom AS nom_hopital,
                h.region,
                h.telephone,
                h.email,
                h.statut,
                h.date_inscription,
                COALESCE(dons.total_dons, 0) AS dons_30j,
                COALESCE(cmd_emises.total, 0) AS commandes_emises_30j,
                COALESCE(cmd_recues.total, 0) AS commandes_recues_30j,
                GREATEST(
                    dons.derniere_activite, 
                    cmd_emises.derniere_activite, 
                    cmd_recues.derniere_activite
                ) AS derniere_activite
            FROM medical_logistics.hopitaux h
            LEFT JOIN (
                SELECT id_hopital_prelevement AS id_hopital, 
                       COUNT(*) AS total_dons, 
                       MAX(date_don) AS derniere_activite
                FROM medical_logistics.historique_dons
                WHERE date_don >= NOW() - INTERVAL '30 days'
                GROUP BY id_hopital_prelevement
            ) dons ON dons.id_hopital = h.id_hopital
            LEFT JOIN (
                SELECT id_hopital_demandeur AS id_hopital, 
                       COUNT(*) AS total, 
                       MAX(date_commande) AS derniere_activite
                FROM medical_logistics.commandes
                WHERE date_commande >= NOW() - INTERVAL '30 days'
                GROUP BY id_hopital_demandeur
            ) cmd_emises ON cmd_emises.id_hopital = h.id_hopital
            LEFT JOIN (
                SELECT id_hopital_vendeur AS id_hopital, 
                       COUNT(*) AS total, 
                       MAX(date_commande) AS derniere_activite
                FROM medical_logistics.commandes
                WHERE date_commande >= NOW() - INTERVAL '30 days'
                GROUP BY id_hopital_vendeur
            ) cmd_recues ON cmd_recues.id_hopital = h.id_hopital
        `;

        const params = [];
        if (filtreRegion) {
            params.push(region);
            query += ` WHERE h.region = $1`;
        }
        query += ` ORDER BY h.region ASC, h.nom ASC;`;

        const result = await db.query(query, params);

        // Regroupement par région, pour un affichage "par zone" côté frontend
        const parRegion = {};
        result.rows.forEach(h => {
            const region = h.region || 'Non renseignée';
            if (!parRegion[region]) parRegion[region] = [];
            parRegion[region].push(h);
        });

        res.status(200).json({ hopitaux: result.rows, par_region: parRegion });

    } catch (error) {
        console.error("Erreur activité hôpitaux :", error);
        res.status(500).json({ message: "Erreur lors du chargement de l'activité des établissements." });
    }
};

// GET /api/admin/carte-reseau
//
// Vue cartographique du réseau pour l'Admin (Leaflet). Contrairement à
// pochesController.getReseauHopitaux (destinée à un hôpital connecté, qui
// s'exclut lui-même de la liste), cette fonction renvoie TOUS les
// établissements actifs du réseau, sans exclusion, avec leur résumé de
// stock et leur statut — nécessaire pour une vue de supervision globale.
exports.getCarteReseau = async (req, res) => {
    try {
        const query = `
            WITH stock_par_groupe AS (
                SELECT 
                    id_hopital, 
                    groupe_sanguin, 
                    COUNT(*)::TEXT AS qte
                FROM medical_logistics.poches_sang
                WHERE statut = 'DISPONIBLE' AND date_peremption >= CURRENT_DATE
                GROUP BY id_hopital, groupe_sanguin
            ),
            resume_hopitaux AS (
                SELECT 
                    id_hopital,
                    STRING_AGG(CONCAT(groupe_sanguin, ' (', qte, ')'), ', ') AS stock_summary,
                    SUM(qte::INTEGER) AS total_stock
                FROM stock_par_groupe
                GROUP BY id_hopital
            )
            SELECT 
                h.id_hopital AS "id",
                h.nom AS "name",
                h.latitude,
                h.longitude,
                h.telephone AS "phone",
                h.region,
                h.statut,
                COALESCE(r.stock_summary, 'Aucun stock') AS "stock_summary",
                COALESCE(r.total_stock, 0) AS total_stock
            FROM medical_logistics.hopitaux h
            LEFT JOIN resume_hopitaux r ON h.id_hopital = r.id_hopital
            WHERE h.latitude IS NOT NULL AND h.longitude IS NOT NULL
            ORDER BY h.nom ASC;
        `;
        const result = await db.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur carte réseau :", error);
        res.status(500).json({ message: "Erreur lors du chargement de la carte du réseau." });
    }
};
