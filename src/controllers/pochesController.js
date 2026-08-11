// src/controllers/pochesController.js


const db = require('../../config/db');

// 1. ENREGISTRER UNE NOUVELLE POCHE DE SANG (DON / PRÉLÈVEMENT)
exports.enregistrerPoche = async (req, res) => {
    const { id_donneur, groupe_sanguin, composant, volume_ml, date_collecte } = req.body;
    const id_hopital = req.user.id_hopital;

    if (!groupe_sanguin || !composant || !volume_ml || !date_collecte) {
        return res.status(400).json({
            message: "Le groupe sanguin, le composant, le volume et la date de collecte sont requis."
        });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // --- CALCUL DE LA DATE DE PÉREMPTION, DIFFÉRENCIÉ PAR COMPOSANT ---
        const dateDebut = new Date(date_collecte);
        let joursConservation = 42;

        const comp = composant.toUpperCase();
        // Valeurs réellement autorisées par chk_poche_composant :
        // SANG_TOTAL, PLASMA, PLAQUETTES
        if (comp.includes("PLAQUETTE")) {
            joursConservation = 5;
        } else if (comp.includes("PLASMA")) {
            joursConservation = 365;
        } else if (comp.includes("SANG_TOTAL")) {
            joursConservation = 42;
        }

        const datePeremption = new Date(dateDebut);
        datePeremption.setDate(datePeremption.getDate() + joursConservation);

        const insertPocheQuery = `
            INSERT INTO medical_logistics.poches_sang 
            (id_hopital, id_donneur, groupe_sanguin, composant, volume_ml, date_collecte, date_peremption, statut)
            VALUES ($1, $2, UPPER($3), UPPER($4), $5, $6, $7, 'DISPONIBLE')
            RETURNING *;
        `;

        const pocheResult = await client.query(insertPocheQuery, [
            id_hopital,
            id_donneur || null,
            groupe_sanguin,
            composant,
            volume_ml,
            date_collecte,
            datePeremption
        ]);

        const nouvellePoche = pocheResult.rows[0];

        // Trace le mouvement d'entrée en stock (historique_mouvements),
        // consommé par le tableau d'historique du frontend (stock.js).
        await client.query(
            `INSERT INTO medical_logistics.historique_mouvements
                (id_hopital, groupe_sanguin, composant, quantite_poches, type_mouvement)
             VALUES ($1, $2, $3, 1, 'ENTREE');`,
            [id_hopital, groupe_sanguin.toUpperCase(), composant.toUpperCase()]
        );

        await client.query('COMMIT');

        res.status(201).json({
            message: `Poche enregistrée avec succès. Durée de conservation : ${joursConservation} jours.`,
            poche: nouvellePoche
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur lors de l'enregistrement de la poche :", error);
        res.status(500).json({ message: "Erreur lors de l'enregistrement de la poche de sang." });
    } finally {
        client.release();
    }
};

// 2. OBTENIR LE STOCK ACTUEL DE L'HÔPITAL (détaillé, poche par poche)
exports.getStockInterne = async (req, res) => {
    const id_hopital = req.user.id_hopital;
    const { groupe, composant } = req.query;

    try {
        let queryText = `
            SELECT id_poche, groupe_sanguin, composant, volume_ml, date_collecte, date_peremption, statut
            FROM medical_logistics.poches_sang
            WHERE id_hopital = $1 
              AND statut = 'DISPONIBLE' 
              AND date_peremption > NOW()
        `;
        
        const params = [id_hopital];

        if (groupe && groupe !== 'ALL') {
            params.push(groupe.toUpperCase());
            queryText += ` AND groupe_sanguin = $${params.length}`;
        }

        if (composant && composant !== 'ALL') {
            params.push(composant.toUpperCase());
            queryText += ` AND composant = $${params.length}`;
        }

        queryText += ` ORDER BY date_peremption ASC;`;

        const result = await db.query(queryText, params);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur de récupération du stock filtré :", error);
        res.status(500).json({ message: "Erreur de chargement du stock." });
    }
};

// 3. OBTENIR LE STOCK AGRÉGÉ DE L'HÔPITAL (groupé par groupe sanguin + composant,
// utile pour les cartes de synthèse du tableau de bord)
exports.getStockAgrege = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    try {
        const queryText = `
            SELECT groupe_sanguin, composant, COUNT(*) as quantite_disponible
            FROM medical_logistics.poches_sang
            WHERE id_hopital = $1 
              AND statut = 'DISPONIBLE' 
              AND date_peremption > NOW()
            GROUP BY groupe_sanguin, composant
            ORDER BY groupe_sanguin, composant;
        `;
        const result = await db.query(queryText, [id_hopital]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur de récupération du stock agrégé :", error);
        res.status(500).json({ message: "Erreur de chargement du stock agrégé." });
    }
};

// 4. RECHERCHE URGENTE DE SANG DANS LE RÉSEAU (hors de son propre hôpital)
exports.searchUrgentBlood = async (req, res) => {
    const { groupe } = req.query;
    const idHopitalConnecte = req.user.id_hopital;

    if (!groupe) {
        return res.status(400).json({ message: "Veuillez préciser un groupe sanguin." });
    }

    try {
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
              AND p.date_peremption > NOW()
              AND h.id_hopital != $2
            GROUP BY h.id_hopital, h.nom, h.telephone, h.latitude, h.longitude;
        `;

        const result = await db.query(query, [groupe.toUpperCase(), idHopitalConnecte]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur recherche urgente de sang :", error);
        res.status(500).json({ message: "Erreur serveur lors de la recherche." });
    }
};

// 5. DÉSTOCKAGE FIFO PAR GROUPE SANGUIN ET QUANTITÉ

exports.utiliserPocheParGroupe = async (req, res) => {
    const { groupe_sanguin, quantite, motif } = req.body;
    const id_hopital = req.user.id_hopital;

    if (!groupe_sanguin || !quantite || quantite < 1) {
        return res.status(400).json({ message: "Le groupe sanguin et une quantité valide sont requis." });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const selectQuery = `
            SELECT id_poche FROM medical_logistics.poches_sang
            WHERE id_hopital = $1 AND groupe_sanguin = $2 AND statut = 'DISPONIBLE'
            ORDER BY date_peremption ASC
            LIMIT $3
            FOR UPDATE SKIP LOCKED;
        `;
        const selectResult = await client.query(selectQuery, [id_hopital, groupe_sanguin.toUpperCase(), quantite]);

        if (selectResult.rows.length < quantite) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Stock insuffisant. Poches disponibles : ${selectResult.rows.length}.`
            });
        }

        const idsAUtiliser = selectResult.rows.map(r => r.id_poche);

        await client.query(
            `UPDATE medical_logistics.poches_sang SET statut = 'UTILISE' WHERE id_poche = ANY($1::uuid[]);`,
            [idsAUtiliser]
        );

        // Trace le mouvement de sortie. NOTE : historique_mouvements n'a pas
        // de colonne "motif" dans le schéma réel — l'information saisie par
        // l'utilisateur n'est donc pas persistée pour l'instant (signalé
        // pour évolution future si la traçabilité du motif est requise).
        await client.query(
            `INSERT INTO medical_logistics.historique_mouvements
                (id_hopital, groupe_sanguin, composant, quantite_poches, type_mouvement)
             VALUES ($1, $2, 'SANG_TOTAL', $3, 'SORTIE');`,
            [id_hopital, groupe_sanguin.toUpperCase(), quantite]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: `${quantite} poche(s) de ${groupe_sanguin.toUpperCase()} marquée(s) comme utilisée(s).`,
            poches_utilisees: idsAUtiliser
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur lors du déstockage :", error);
        res.status(500).json({ message: "Erreur lors du déstockage." });
    } finally {
        client.release();
    }
};

// 6. HISTORIQUE DES MOUVEMENTS DE STOCK (entrées et sorties)
exports.getHistoriqueStock = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    try {
        const result = await db.query(
            `SELECT id_mouvement, groupe_sanguin, composant, quantite_poches AS quantite, 
                    type_mouvement, date_mouvement
             FROM medical_logistics.historique_mouvements
             WHERE id_hopital = $1
             ORDER BY date_mouvement DESC
             LIMIT 100;`,
            [id_hopital]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération historique stock :", error);
        res.status(500).json({ message: "Erreur lors du chargement de l'historique." });
    }
};

// 7. STOCK AGRÉGÉ PAR GROUPE SANGUIN, AVEC VOLUME CUMULÉ (pour cartes de synthèse)
// Route attendue par le frontend : GET /api/stocks/aggregated
exports.getStockAggregatedWithVolume = async (req, res) => {
    const idHopital = req.user.id_hopital;

    try {
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
        res.status(500).json({ message: "Erreur serveur lors de la récupération du stock." });
    }
};

// 8. CARTE RÉSEAU DES HÔPITAUX AVEC RÉSUMÉ DE STOCK (pour la carte Leaflet)
// Route attendue par le frontend : GET /api/stocks/network
exports.getReseauHopitaux = async (req, res) => {
    const idHopitalConnecte = req.user.id_hopital;

    try {
        const query = `
            WITH stock_par_groupe AS (
                SELECT 
                    id_hopital, 
                    groupe_sanguin, 
                    COUNT(*)::TEXT AS qte
                FROM medical_logistics.poches_sang
                WHERE statut = 'DISPONIBLE'
                GROUP BY id_hopital, groupe_sanguin
            ),
            resume_hopitaux AS (
                SELECT 
                    id_hopital,
                    STRING_AGG(CONCAT(groupe_sanguin, ' (', qte, ')'), ', ') AS stock_summary
                FROM stock_par_groupe
                GROUP BY id_hopital
            )
            SELECT 
                h.id_hopital AS "id", 
                h.nom AS "name", 
                h.latitude, 
                h.longitude, 
                h.telephone AS "phone",
                COALESCE(r.stock_summary, 'Aucun stock') AS "stock_summary"
            FROM medical_logistics.hopitaux h
            LEFT JOIN resume_hopitaux r ON h.id_hopital = r.id_hopital
            WHERE h.id_hopital != $1;
        `;
        const result = await db.query(query, [idHopitalConnecte]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur SQL (Réseau Hôpitaux) :", error);
        res.status(500).json({ message: "Erreur serveur lors du chargement du réseau." });
    }
};
// OBTENIR LES STATISTIQUES KPI DU DASHBOARD HOME
exports.getDashboardKPIs = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    try {
        const queryText = `
            SELECT 
                -- 1. Total des poches disponibles et non périmées
                (SELECT COUNT(*) 
                 FROM medical_logistics.poches_sang 
                 WHERE id_hopital = $1 AND statut = 'DISPONIBLE' AND date_peremption > NOW()
                ) AS total_stock,

                -- 2. Poches à stock critique (ex: Groupes O- et A- ou périmant dans moins de 5 jours)
                (SELECT COUNT(*) 
                 FROM medical_logistics.poches_sang 
                 WHERE id_hopital = $1 
                   AND statut = 'DISPONIBLE' 
                   AND date_peremption > NOW()
                   AND (groupe_sanguin IN ('O-', 'A-') OR date_peremption <= NOW() + INTERVAL '5 days')
                ) AS critical_stock,

                -- 3. Commandes en cours / en attente de livraison
                (SELECT COUNT(*) 
                 FROM medical_logistics.commandes 
                 WHERE (id_hopital_demandeur = $1 OR id_hopital_fournisseur = $1)
                   AND statut IN ('EN_ATTENTE', 'EN_TRANSIT')
                ) AS pending_orders,

                -- 4. Donneurs enregistrés ou ayant donné dans les 30 derniers jours
                (SELECT COUNT(DISTINCT id_donneur) 
                 FROM medical_logistics.donneufs_collectes 
                 WHERE id_hopital = $1 AND date_don >= NOW() - INTERVAL '30 days'
                ) AS active_donors;
        `;

        const result = await db.query(queryText, [id_hopital]);
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error("Erreur de récupération des KPIs :", error);
        res.status(500).json({ message: "Erreur de chargement des statistiques KPI." });
    }
};