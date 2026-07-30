const db = require('../../config/db'); // Chemin remontant de 2 niveaux vers config/db.js

// 1. Mise à jour du stock ou ajout d'une poche de sang
const updateStock = async (req, res) => {
    try {
        const idHopital = req.user.id_hopital || req.user.id;
        const { groupeSanguin, volumeMl, dateCollecte, composant } = req.body;

        if (!groupeSanguin || !volumeMl) {
            return res.status(400).json({ message: "Le groupe sanguin et le volume sont requis." });
        }

        // Insertion d'une nouvelle poche de sang dans la table
        const query = `
            INSERT INTO medical_logistics.poches_sang 
                (id_hopital, groupe_sanguin, composant, volume_ml, date_collecte, date_peremption, statut)
            VALUES 
                ($1, $2, $3, $4, $5, $5::date + INTERVAL '42 days', 'DISPONIBLE')
            RETURNING *;
        `;

        const { bloodGroup, volume, collectionDate, categorie } = req.body;

        const values = [
            idHopital, 
            bloodGroup, 
            categorie || 'SANG_TOTAL', 
            parseInt(volume), 
         collectionDate || new Date().toISOString().split('T')[0]
        ];

        const result = await db.query(query, values);

        res.status(201).json({
            message: "Stock mis à jour avec succès",
            poche: result.rows[0]
        });

    } catch (error) {
        console.error("Erreur dans updateStock :", error);
        res.status(500).json({ message: "Erreur serveur lors de la mise à jour du stock" });
    }
};

// 2. Récupérer tout le stock détaillé de l'hôpital connecté
const getMyStock = async (req, res) => {
    try {
        const idHopital = req.user.id_hopital || req.user.id;

        const query = `
            SELECT 
                id_poche,
                groupe_sanguin,
                composant,
                volume_ml,
                date_collecte,
                date_peremption,
                statut
            FROM medical_logistics.poches_sang
            WHERE id_hopital = $1 AND statut = 'DISPONIBLE'
            ORDER BY date_peremption ASC;
        `;

        const result = await db.query(query, [idHopital]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Erreur dans getMyStock :", error);
        res.status(500).json({ message: "Erreur serveur lors de la récupération du stock" });
    }
};

// 3. Recherche urgente de sang dans le réseau
const searchUrgentBlood = async (req, res) => {
    try {
        const { groupe } = req.query;
        const idHopitalConnecte = req.user.id_hopital || req.user.id;

        if (!groupe) {
            return res.status(400).json({ message: "Veuillez préciser un groupe sanguin." });
        }

        const query = `
            SELECT 
                h.id_hopital,
                h.nom AS hopital_nom,
                h.telephone,
                h.latitude,
                h.longitude,
                COUNT(p.id_poche)::INTEGER AS quantite_disponible
            FROM medical_logistics.hopitaux h
            JOIN medical_logistics.poches_sang p ON h.id_hopital = p.id_hopital
            WHERE p.groupe_sanguin = $1 
              AND p.statut = 'DISPONIBLE'
              AND h.id_hopital != $2
            GROUP BY h.id_hopital, h.nom, h.telephone, h.latitude, h.longitude;
        `;

        const result = await db.query(query, [groupe, idHopitalConnecte]);
        res.status(200).json(result.rows);

    } catch (error) {
        console.error("Erreur dans searchUrgentBlood :", error);
        res.status(500).json({ message: "Erreur serveur lors de la recherche" });
    }
};

module.exports = {
    updateStock,
    getMyStock,
    searchUrgentBlood
};