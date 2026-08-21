// src/controllers/adminController.js
//
// Corrigé suite à l'audit du schéma réel. medical_logistics.commandes n'a
// ni drone_id, ni notes_admin, ni date_validation_admin — ces colonnes
// n'existent pas et ont été retirées des requêtes. Les statuts suivent
// strictement la contrainte check_statut_comm :
//   EN_ATTENTE, ACCEPTEE, REFUSEE, EXPEDIEE, LIVREE, ANNULEE
//
// hopitaux.statut suit chk_hopital_statut : EN_ATTENTE, ACTIF, DESACTIVE.

const db = require('../../config/db');

exports.validateHopital = async (req, res) => {
    const { id } = req.params;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const queryText = `
            UPDATE medical_logistics.hopitaux 
            SET statut = 'ACTIF'
            WHERE id_hopital = $1
            RETURNING *;
        `;

        const result = await client.query(queryText, [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Hôpital introuvable." });
        }

        // CORRECTIF : la validation ne mettait à jour que hopitaux.statut,
        // jamais le statut_compte de l'admin référent (resté EN_ATTENTE
        // depuis l'inscription). Or authController.login vérifie désormais
        // statut_compte === 'ACTIF' avant d'autoriser la connexion — sans
        // cette mise à jour, l'admin de l'hôpital restait bloqué au login
        // même après validation par le SUPER_ADMIN.
        await client.query(
            `UPDATE core_identity.utilisateurs 
             SET statut_compte = 'ACTIF' 
             WHERE id_hopital = $1 AND role = 'ADMIN_HOPITAL' AND statut_compte = 'EN_ATTENTE';`,
            [id]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: "L'hôpital a été validé avec succès !",
            hopital: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur Validation Hôpital :", error);
        res.status(500).json({ message: "Une erreur est survenue lors de la validation." });
    } finally {
        client.release();
    }
};

// Rejeter une demande d'inscription en attente.
//
// AJOUT (audit) : seule l'action "Valider" existait côté admin, il n'y
// avait aucun moyen de refuser une demande — l'hôpital restait
// indéfiniment en file d'attente. On réutilise le statut DESACTIVE (déjà
// autorisé par la contrainte chk_hopital_statut, pas de migration
// nécessaire) : un hôpital rejeté n'apparaît plus dans les demandes en
// attente, et son admin référent ne peut pas se connecter (statut_compte
// suspendu) tant qu'il n'est pas éventuellement réactivé plus tard.
exports.rejeterHopital = async (req, res) => {
    const { id } = req.params;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE medical_logistics.hopitaux
             SET statut = 'DESACTIVE'
             WHERE id_hopital = $1 AND statut = 'EN_ATTENTE'
             RETURNING *;`,
            [id]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Demande introuvable ou déjà traitée." });
        }

        await client.query(
            `UPDATE core_identity.utilisateurs 
             SET statut_compte = 'SUSPENDU' 
             WHERE id_hopital = $1 AND role = 'ADMIN_HOPITAL';`,
            [id]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: "La demande d'inscription a été rejetée.",
            hopital: result.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur Rejet Hôpital :", error);
        res.status(500).json({ message: "Une erreur est survenue lors du rejet." });
    } finally {
        client.release();
    }
};

// Désactiver un hôpital déjà actif (symétrique de validateHopital).
// Ajouté pour combler l'absence d'interface de gestion des comptes
// hospitaliers dans l'espace Admin (public/admin.html).
exports.desactiverHopital = async (req, res) => {
    const { id } = req.params;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE medical_logistics.hopitaux
             SET statut = 'DESACTIVE'
             WHERE id_hopital = $1
             RETURNING *;`,
            [id]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Hôpital introuvable." });
        }

        // CORRECTIF : désactiver un hôpital ne devrait pas laisser son
        // personnel continuer à se connecter à la plateforme. On suspend
        // désormais tous les comptes rattachés (pas seulement l'admin),
        // cohérent avec l'intention métier d'une désactivation.
        await client.query(
            `UPDATE core_identity.utilisateurs 
             SET statut_compte = 'SUSPENDU' 
             WHERE id_hopital = $1 AND statut_compte = 'ACTIF';`,
            [id]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: "L'hôpital a été désactivé.",
            hopital: result.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur Désactivation Hôpital :", error);
        res.status(500).json({ message: "Une erreur est survenue lors de la désactivation." });
    } finally {
        client.release();
    }
};

// Liste des hôpitaux en attente de validation — route dédiée, plus légère
// que de filtrer côté client l'ensemble de GET /api/hospitals/all.
exports.getHopitauxEnAttente = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id_hopital, nom, adresse, telephone, email, latitude, longitude, region
             FROM medical_logistics.hopitaux
             WHERE statut = 'EN_ATTENTE'
             ORDER BY nom ASC;`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération hôpitaux en attente :", error);
        res.status(500).json({ message: "Erreur lors du chargement des demandes en attente." });
    }
};

// Récupérer les commandes à arbitrer
exports.getPendingOrders = async (req, res) => {
    try {
        const pendingQuery = `
            SELECT c.*, 
                   h_dem.nom AS hopital_demandeur, 
                   h_vend.nom AS hopital_fournisseur,
                   (c.groupe_sanguin || c.rhesus) AS groupe_sanguin_complet,
                   c.quantite AS quantite_poches
            FROM medical_logistics.commandes c
            JOIN medical_logistics.hopitaux h_dem ON c.id_hopital_demandeur = h_dem.id_hopital
            JOIN medical_logistics.hopitaux h_vend ON c.id_hopital_vendeur = h_vend.id_hopital
            WHERE c.statut = 'EN_ATTENTE'
            ORDER BY c.date_commande ASC;
        `;

        const historyQuery = `
            SELECT c.*, 
                   h_dem.nom AS hopital_demandeur, 
                   h_vend.nom AS hopital_fournisseur,
                   (c.groupe_sanguin || c.rhesus) AS groupe_sanguin_complet,
                   c.quantite AS quantite_poches,
                   c.commentaire_admin,
                   c.drone_assigne
            FROM medical_logistics.commandes c
            JOIN medical_logistics.hopitaux h_dem ON c.id_hopital_demandeur = h_dem.id_hopital
            JOIN medical_logistics.hopitaux h_vend ON c.id_hopital_vendeur = h_vend.id_hopital
            WHERE c.statut IN ('ACCEPTEE', 'REFUSEE', 'EXPEDIEE', 'LIVREE', 'ANNULEE')
            ORDER BY c.date_commande DESC LIMIT 20;
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

// Statuer sur une commande (Accepter / Refuser)
// NOTE : le frontend (admin-orders.js) envoie statut_decision, drone_id, note.
// Ces deux derniers sont désormais persistés dans commentaire_admin et
// drone_assigne (cf. migration 005_commande_decision_admin.sql).
exports.arbitrerCommande = async (req, res) => {
    const { id_commande, statut_decision, drone_id, note } = req.body;

    // Normalisation : le frontend peut envoyer d'anciens libellés
    // (APPROUVEE/REJETEE_ADMIN) — on les fait correspondre aux vraies
    // valeurs de la contrainte CHECK pour rester tolérant.
    const statutNormalise = (statut_decision === 'REJETEE_ADMIN' || statut_decision === 'REFUSEE')
        ? 'REFUSEE'
        : (statut_decision === 'APPROUVEE' || statut_decision === 'ACCEPTEE')
            ? 'ACCEPTEE'
            : statut_decision;

    if (!['ACCEPTEE', 'REFUSEE'].includes(statutNormalise)) {
        return res.status(400).json({ message: "Décision invalide. Valeurs attendues : ACCEPTEE ou REFUSEE." });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        if (statutNormalise === 'REFUSEE') {
            await client.query(`
                UPDATE medical_logistics.commandes 
                SET statut = 'REFUSEE', commentaire_admin = $2
                WHERE id_commande = $1
            `, [id_commande, note || null]);

            // Libérer les poches précédemment réservées pour cette commande,
            // pour qu'elles redeviennent disponibles pour d'autres demandes.
            await client.query(`
                UPDATE medical_logistics.poches_sang
                SET statut = 'DISPONIBLE'
                WHERE id_poche IN (
                    SELECT id_poche FROM medical_logistics.commande_poches
                    WHERE id_commande = $1
                )
            `, [id_commande]);

        } else {
            // ACCEPTEE : la commande passe directement à EXPEDIEE, ce qui
            // déclenche l'initialisation de la télémétrie simulée au premier
            // appel de GET /api/commandes/telemetrie/:id (cf. commandeController).
            await client.query(`
                UPDATE medical_logistics.commandes 
                SET statut = 'EXPEDIEE', commentaire_admin = $2, drone_assigne = $3
                WHERE id_commande = $1
            `, [id_commande, note || null, drone_id || null]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Commande mise à jour : ${statutNormalise}` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur arbitrage :", error);
        res.status(500).json({ message: "Échec de l'arbitrage." });
    } finally {
        client.release();
    }
};
