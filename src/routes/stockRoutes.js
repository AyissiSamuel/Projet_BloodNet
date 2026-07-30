const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');
const { verifyToken } = require('../middlewares/authMiddleware');
const db = require('../../config/db'); 

// --- Routes existantes ---
router.put('/update', verifyToken, stockController.updateStock);
router.get('/my-stock', verifyToken, stockController.getMyStock);
router.get('/search', verifyToken, stockController.searchUrgentBlood);

// --- Route 1 : Stock agrégé (pour le dashboard) ---
router.get('/aggregated', verifyToken, async (req, res) => {
    try {
        const idHopital = req.user.id_hopital || req.user.id;

        const query = `
            SELECT 
                groupe_sanguin AS "blood_group", 
                COUNT(*)::INTEGER AS "total_count", 
                COALESCE(SUM(volume_ml), 0)::INTEGER AS "total_volume"
            FROM medical_logistics.poches_sang 
            WHERE id_hopital = $1 AND statut = 'DISPONIBLE'
            GROUP BY groupe_sanguin
            ORDER BY groupe_sanguin ASC;
        `;

        const result = await db.query(query, [idHopital]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Erreur SQL (Stock agrégé) :", error);
        res.status(500).json({ message: "Erreur serveur lors de la récupération du stock" });
    }
});

// --- Route 2 : Carte réseau hôpitaux (optimisée) ---
// --- Route 2 : Carte réseau hôpitaux (Correction PostgreSQL 42803) ---
router.get('/network', verifyToken, async (req, res) => {
    try {
        const idHopitalConnecte = req.user.id_hopital || req.user.id;

        const query = `
            WITH stock_par_groupe AS (
                -- 1. On compte les poches par hôpital ET par groupe sanguin
                SELECT 
                    id_hopital, 
                    groupe_sanguin, 
                    COUNT(*)::TEXT AS qte
                FROM medical_logistics.poches_sang
                WHERE statut = 'DISPONIBLE'
                GROUP BY id_hopital, groupe_sanguin
            ),
            résumé_hôpitaux AS (
                -- 2. On regroupe les textes formatés "O+ (5)" par hôpital
                SELECT 
                    id_hopital,
                    STRING_AGG(CONCAT(groupe_sanguin, ' (', qte, ')'), ', ') AS stock_summary
                FROM stock_par_groupe
                GROUP BY id_hopital
            )
            -- 3. On joint avec la liste des hôpitaux partenaires
            SELECT 
                h.id_hopital AS "id", 
                h.nom AS "name", 
                h.latitude, 
                h.longitude, 
                h.telephone AS "phone",
                COALESCE(r.stock_summary, 'Aucun stock') AS "stock_summary"
            FROM medical_logistics.hopitaux h
            LEFT JOIN résumé_hôpitaux r ON h.id_hopital = r.id_hopital
            WHERE h.id_hopital != $1;
        `;

        const result = await db.query(query, [idHopitalConnecte]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Erreur SQL (Réseau Hôpitaux) :", error);
        res.status(500).json({ message: "Erreur serveur lors du chargement du réseau" });
    }
});

module.exports = router;