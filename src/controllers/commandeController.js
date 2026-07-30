const db = require('../../config/db');
const socketConfig = require('../../config/socket');

// 1. PASSER UNE COMMANDE DIRECTE (Réservation atomique de poches)
exports.passerCommande = async (req, res) => {
    const { id_hopital_vendeur, groupe_sanguin, rhesus, quantite } = req.body;
    const id_hopital_demandeur = req.user.id_hopital || req.user.id;

    if (!id_hopital_vendeur || !groupe_sanguin || !rhesus || !quantite) {
        return res.status(400).json({ message: "Toutes les informations de commande sont requises." });
    }

    if (id_hopital_demandeur === id_hopital_vendeur) {
        return res.status(400).json({ message: "Action invalide : vous ne pouvez pas commander chez vous-même." });
    }

    // Le groupe sanguin complet stocké dans poches_sang (ex: "A" + "+" = "A+")
    const groupeComplet = `${groupe_sanguin.toUpperCase()}${rhesus}`;

    const client = await db.connect(); 
    try {
        await client.query('BEGIN'); 
        // 1. Verrouiller et sélectionner les poches disponibles chez le vendeur
        const selectPochesQuery = `
            SELECT id_poche 
            FROM medical_logistics.poches_sang 
            WHERE id_hopital = $1 
              AND groupe_sanguin = $2 
              AND statut = 'DISPONIBLE'
              AND date_peremption >= CURRENT_DATE
            ORDER BY date_peremption ASC
            LIMIT $3
            FOR UPDATE SKIP LOCKED;
        `;
        const pochesResult = await client.query(selectPochesQuery, [id_hopital_vendeur, groupeComplet, parseInt(quantite)]);

        if (pochesResult.rows.length < quantite) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: `Stock insuffisant chez le vendeur. Poches disponibles : ${pochesResult.rows.length}` 
            });
        }

        // Récupérer les IDs des poches réservées
        const idPochesAReserver = pochesResult.rows.map(row => row.id_poche);

        // 2. Mettre à jour le statut des poches physiques en 'RESERVE'
        const updatePochesQuery = `
            UPDATE medical_logistics.poches_sang
            SET statut = 'RESERVE'
            WHERE id_poche = ANY($1::uuid[]);
        `;
        await client.query(updatePochesQuery, [idPochesAReserver]);

        // 3. Enregistrer la commande B2B
        const insertCommandeQuery = `
        INSERT INTO medical_logistics.commandes 
            (id_hopital_demandeur, id_hopital_vendeur, groupe_sanguin, rhesus, quantite, statut)
        VALUES ($1, $2, UPPER($3), $4, $5, 'EN_ATTENTE_ADMIN')
        RETURNING *;
    `;
        const commandeResult = await client.query(insertCommandeQuery, [
            id_hopital_demandeur, 
            id_hopital_vendeur, 
            groupe_sanguin, 
            rhesus, 
            quantite
        ]);
        
        const nouvelleCommande = commandeResult.rows[0];

        await client.query('COMMIT'); // Validation définitive de la réservation

        // Récupérer le nom de l'hôpital acheteur
        const acheteurInfo = await db.query(
            'SELECT nom FROM medical_logistics.hopitaux WHERE id_hopital = $1', 
            [id_hopital_demandeur]
        );
        nouvelleCommande.nom_hopital_demandeur = acheteurInfo.rows[0]?.nom;

        // Notification WebSocket
        try {
            const io = socketConfig.getIO();
            if (io) {
                io.to(`hospital_${id_hopital_vendeur}`).emit('nouvelle_commande', {
                    message: `Nouvelle commande directe reçue de : ${nouvelleCommande.nom_hopital_demandeur}`,
                    commande: nouvelleCommande
                });
            }
        } catch (wsErr) {
            console.warn("Avertissement WebSocket :", wsErr.message);
        }

        res.status(201).json({
            message: "Commande passée avec succès. Les poches de sang ont été réservées.",
            commande: nouvelleCommande
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur transaction commande :", error);
        res.status(500).json({ message: "Échec du processus de commande." });
    } finally {
        client.release();
    }
};

// 2. CONSULTER LES COMMANDES (Émises et Reçues)
exports.getMyCommandes = async (req, res) => {
    const id_hopital = req.user.id_hopital || req.user.id;

    try {
        const queryText = `
            SELECT c.*, 
                   h_dem.nom AS acheteur_nom, 
                   h_vend.nom AS vendeur_nom,
                   CASE WHEN c.id_hopital_demandeur = $1 THEN 'EMISE' ELSE 'RECUE' END AS type_commande
            FROM medical_logistics.commandes c
            INNER JOIN medical_logistics.hopitaux h_dem ON c.id_hopital_demandeur = h_dem.id_hopital
            INNER JOIN medical_logistics.hopitaux h_vend ON c.id_hopital_vendeur = h_vend.id_hopital
            WHERE c.id_hopital_demandeur = $1 OR c.id_hopital_vendeur = $1
            ORDER BY c.date_commande DESC;
        `;
        const result = await db.query(queryText, [id_hopital]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur chargement commandes :", error);
        res.status(500).json({ message: "Erreur lors du chargement de la liste de commandes." });
    }
};