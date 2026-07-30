const db = require('../../config/db');

exports.validateHopital = async (req, res) => {
    const { id } = req.params; // Récupère l'id_hopital depuis l'URL

    try {
        // Mise à jour du statut de l'hôpital
        const queryText = `
            UPDATE medical_logistics.hopitaux 
            SET statut = 'ACTIF'
            WHERE id_hopital = $1
            RETURNING *;
        `;
        
        const result = await db.query(queryText, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Hôpital introuvable." });
        }

        res.status(200).json({
            message: "L'hôpital a été validé avec succès !",
            hopital: result.rows[0]
        });

    } catch (error) {
        console.error("Erreur Validation Hôpital :", error);
        res.status(500).json({ message: "Une erreur est survenue lors de la validation." });
    }
};

// Récupérer les commandes à arbitrer
exports.getPendingOrders = async (req, res) => {
    try {
        // Commandes en attente de validation administrative
        const pendingQuery = `
            SELECT c.*, 
                   h_dem.nom AS hopital_demandeur, 
                   h_vend.nom AS hopital_fournisseur,
                   (c.groupe_sanguin || c.rhesus) AS groupe_sanguin,
                   c.quantite AS quantite_poches,
                   c.id_commande
            FROM medical_logistics.commandes c
            JOIN medical_logistics.hopitaux h_dem ON c.id_hopital_demandeur = h_dem.id_hopital
            JOIN medical_logistics.hopitaux h_vend ON c.id_hopital_vendeur = h_vend.id_hopital
            WHERE c.statut = 'EN_ATTENTE_ADMIN'
            ORDER BY c.date_commande ASC;
        `;

        // Historique des décisions
        const historyQuery = `
            SELECT c.*, 
                   h_dem.nom AS hopital_demandeur, 
                   h_vend.nom AS hopital_fournisseur,
                   (c.groupe_sanguin || c.rhesus) AS groupe_sanguin,
                   c.quantite AS quantite_poches,
                   c.statut AS statut,
                   c.date_validation_admin AS date_decision
            FROM medical_logistics.commandes c
            JOIN medical_logistics.hopitaux h_dem ON c.id_hopital_demandeur = h_dem.id_hopital
            JOIN medical_logistics.hopitaux h_vend ON c.id_hopital_vendeur = h_vend.id_hopital
            WHERE c.statut IN ('APPROUVEE', 'REJETEE_ADMIN', 'EN_TRANSIT', 'LIVREE')
            ORDER BY c.date_validation_admin DESC LIMIT 20;
        `;

        const [pendingRes, historyRes] = await Promise.all([
            db.query(pendingQuery),
            db.query(historyQuery)
        ]);

        res.status(200).json({
            pending: pendingRes.rows,
            history: historyRes.rows
        });
    } catch (error) {
        console.error("Erreur récupération commandes admin :", error);
        res.status(500).json({ message: "Erreur serveur lors de la récupération des commandes." });
    }
};

// Statuer sur une commande (Approuver / Rejeter)
exports.arbitrerCommande = async (req, res) => {
    const { id_commande, statut_decision, drone_id, note } = req.body;
    const admin_id = req.user.id;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Si rejetée par l'admin -> Libérer les poches réservées
        if (statut_decision === 'REJETEE_ADMIN') {
            // Mettre à jour la commande
            await client.query(`
                UPDATE medical_logistics.commandes 
                SET statut = 'REJETEE_ADMIN', notes_admin = $1, date_validation_admin = CURRENT_TIMESTAMP
                WHERE id_commande = $2
            `, [note, id_commande]);

            // Remettre les poches associées en DISPONIBLE (selon votre gestion des poches)
            // ... (logique de libération de stock)
        } else {
            // Si approuvée
            await client.query(`
                UPDATE medical_logistics.commandes 
                SET statut = 'APPROUVEE', drone_id = $1, notes_admin = $2, date_validation_admin = CURRENT_TIMESTAMP
                WHERE id_commande = $3
            `, [drone_id, note, id_commande]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Commande mise à jour : ${statut_decision}` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur arbitrage :", error);
        res.status(500).json({ message: "Échec de l'arbitrage." });
    } finally {
        client.release();
    }
};
