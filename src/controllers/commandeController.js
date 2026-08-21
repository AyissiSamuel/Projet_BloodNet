// src/controllers/commandeController.js

const db = require('../../config/db');
const socketConfig = require('../../config/socket');
// CORRECTIF : ce require manquait totalement. getTelemetrieCommande (plus
// bas) appelle droneService.getTelemetrieEtPersister / .demarrerMission,
// mais sans cette ligne l'appel plantait systématiquement avec
// "droneService is not defined" — c'est ce qui rendait toute la simulation
// de livraison inopérante (le suivi du drone ne s'affichait jamais).
const droneService = require('../services/droneSimulationService');

// 1. PASSER UNE COMMANDE DIRECTE (Réservation atomique de poches)
//
// NOTE DE SYNCHRONISATION FRONT/BACK :
// Le formulaire du frontend (public/js/modules/orders.js) envoie le champ
// "hopital_destinataire" plutôt que "id_hopital_vendeur". On accepte ici les
// deux noms pour ne pas casser le frontend existant.
exports.passerCommande = async (req, res) => {
    const {
        id_hopital_vendeur,
        hopital_destinataire, // alias accepté depuis le frontend actuel
        groupe_sanguin,
        rhesus,
        quantite
    } = req.body;

    const vendeurId = id_hopital_vendeur || hopital_destinataire;
    const id_hopital_demandeur = req.user.id_hopital;

    if (!vendeurId || !groupe_sanguin || !quantite) {
        return res.status(400).json({ message: "Toutes les informations de commande sont requises." });
    }
    if (!id_hopital_demandeur) {
        return res.status(403).json({ message: "Seul un compte rattaché à un hôpital peut passer commande." });
    }
    if (String(id_hopital_demandeur) === String(vendeurId)) {
        return res.status(400).json({ message: "Action invalide : vous ne pouvez pas commander chez vous-même." });
    }

    // Le frontend envoie parfois un groupe complet ("A+") au lieu du groupe
    // séparé + rhésus attendus par medical_logistics.commandes (contrainte
    // check_groupe_comm : 'A', 'B', 'AB', 'O' uniquement, rhésus séparé).
    let groupeSeul = groupe_sanguin.toUpperCase();
    let rhesusSeul = rhesus;
    if (!rhesusSeul && /[+-]$/.test(groupeSeul)) {
        rhesusSeul = groupeSeul.slice(-1);
        groupeSeul = groupeSeul.slice(0, -1);
    }
    const groupeComplet = `${groupeSeul}${rhesusSeul}`; // format complet, utilisé pour interroger poches_sang

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Verrouiller et sélectionner les poches disponibles chez le vendeur
        // (poches_sang.groupe_sanguin est au format complet "A+", contrairement
        // à commandes.groupe_sanguin qui est séparé).
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
        const pochesResult = await client.query(selectPochesQuery, [vendeurId, groupeComplet, parseInt(quantite)]);

        if (pochesResult.rows.length < quantite) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Stock insuffisant chez le vendeur. Poches disponibles : ${pochesResult.rows.length}`
            });
        }

        const idPochesAReserver = pochesResult.rows.map(row => row.id_poche);

        // 2. Mettre à jour le statut des poches physiques en 'RESERVE'
        await client.query(
            `UPDATE medical_logistics.poches_sang SET statut = 'RESERVE' WHERE id_poche = ANY($1::uuid[]);`,
            [idPochesAReserver]
        );

        // 3. Enregistrer la commande B2B (statut initial : EN_ATTENTE, seule
        // valeur de départ valide selon la contrainte check_statut_comm)
        const insertCommandeQuery = `
            INSERT INTO medical_logistics.commandes 
                (id_hopital_demandeur, id_hopital_vendeur, groupe_sanguin, rhesus, quantite, statut)
            VALUES ($1, $2, $3, $4, $5, 'EN_ATTENTE')
            RETURNING *;
        `;
        const commandeResult = await client.query(insertCommandeQuery, [
            id_hopital_demandeur,
            vendeurId,
            groupeSeul,
            rhesusSeul,
            quantite
        ]);

        const nouvelleCommande = commandeResult.rows[0];

        // 4. Tracer précisément quelles poches sont associées à cette commande,
        // pour permettre leur libération fiable en cas de refus par l'Admin.
        const insertLiaisonQuery = `
            INSERT INTO medical_logistics.commande_poches (id_commande, id_poche)
            SELECT $1, unnest($2::uuid[]);
        `;
        await client.query(insertLiaisonQuery, [nouvelleCommande.id_commande, idPochesAReserver]);

        await client.query('COMMIT');

        const acheteurInfo = await db.query(
            'SELECT nom FROM medical_logistics.hopitaux WHERE id_hopital = $1',
            [id_hopital_demandeur]
        );
        nouvelleCommande.nom_hopital_demandeur = acheteurInfo.rows[0]?.nom;

        try {
            const io = socketConfig.getIO();
            if (io) {
                io.to(`hospital_${vendeurId}`).emit('nouvelle_commande', {
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

// Alias attendu par le frontend actuel (POST /api/commandes/creer).
exports.creerCommande = exports.passerCommande;

// 2. CONSULTER LES COMMANDES (Émises et Reçues), avec filtrage optionnel ?type=emises|recues
exports.getMyCommandes = async (req, res) => {
    const id_hopital = req.user.id_hopital;
    const { type } = req.query; // 'emises' | 'recues' | undefined (= toutes)

    if (!id_hopital) {
        return res.status(200).json([]); // ex. SUPER_ADMIN sans hôpital rattaché
    }

    try {
        let queryText = `
            SELECT c.*, 
                   h_dem.nom AS hopital_demandeur,
                   h_vend.nom AS hopital_destinataire,
                   h_vend.nom AS hopital_expediteur,
                   h_dem.nom AS acheteur_nom,
                   h_vend.nom AS vendeur_nom,
                   (c.groupe_sanguin || c.rhesus) AS groupe_sanguin_complet,
                   c.quantite AS quantite_poches,
                   c.statut AS statut_commande,
                   CASE WHEN c.id_hopital_demandeur = $1 THEN 'EMISE' ELSE 'RECUE' END AS type_commande
            FROM medical_logistics.commandes c
            INNER JOIN medical_logistics.hopitaux h_dem ON c.id_hopital_demandeur = h_dem.id_hopital
            INNER JOIN medical_logistics.hopitaux h_vend ON c.id_hopital_vendeur = h_vend.id_hopital
            WHERE (c.id_hopital_demandeur = $1 OR c.id_hopital_vendeur = $1)
        `;

        if (type === 'emises') {
            queryText += ` AND c.id_hopital_demandeur = $1`;
        } else if (type === 'recues') {
            queryText += ` AND c.id_hopital_vendeur = $1`;
        }

        queryText += ` ORDER BY c.date_commande DESC;`;

        const result = await db.query(queryText, [id_hopital]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur chargement commandes :", error);
        res.status(500).json({ message: "Erreur lors du chargement de la liste de commandes." });
    }
};

// 3. TÉLÉMÉTRIE DU DRONE POUR UNE COMMANDE EXPÉDIÉE (Option B)
exports.getTelemetrieCommande = async (req, res) => {
    const { id_commande } = req.params;

    try {
        const commandeResult = await db.query(
            `SELECT id_commande, id_hopital_vendeur, id_hopital_demandeur, statut 
             FROM medical_logistics.commandes WHERE id_commande = $1`,
            [id_commande]
        );

        if (commandeResult.rows.length === 0) {
            return res.status(404).json({ message: "Commande introuvable." });
        }

        const commande = commandeResult.rows[0];

        if (commande.statut !== 'EXPEDIEE' && commande.statut !== 'LIVREE') {
            return res.status(400).json({ message: "Cette commande n'est pas en cours de livraison." });
        }

        // Tente de calculer et persister la télémétrie
        let telemetrie = await droneService.getTelemetrieEtPersister(id_commande);

        // Si la mission vient de démarrer ou n'était pas en mémoire
        if (!telemetrie && commande.statut === 'EXPEDIEE') {
            await droneService.demarrerMission(
                commande.id_commande, 
                commande.id_hopital_vendeur, 
                commande.id_hopital_demandeur
            );
            telemetrie = await droneService.getTelemetrieEtPersister(id_commande);
        }

        // Si la livraison vient de se terminer, on met à jour la table métier
        if (telemetrie && telemetrie.statut === 'LIVREE' && commande.statut !== 'LIVREE') {
            await db.query(
                `UPDATE medical_logistics.commandes SET statut = 'LIVREE' WHERE id_commande = $1`,
                [id_commande]
            );
        }

        res.status(200).json(telemetrie);

    } catch (error) {
        console.error("Erreur télémétrie commande :", error);
        res.status(500).json({ message: error.message || "Erreur lors de la récupération de la télémétrie." });
    }
};
// Initialise le suivi de livraison : crée la ligne dans drone_telemetry.commandes
// à la position de l'hôpital vendeur (départ de la mission simulée).
async function initialiserTelemetrie(commande) {
    const hopitauxResult = await db.query(
        `SELECT id_hopital, latitude, longitude FROM medical_logistics.hopitaux 
         WHERE id_hopital = ANY($1::uuid[])`,
        [[commande.id_hopital_vendeur, commande.id_hopital_demandeur]]
    );

    const depart = hopitauxResult.rows.find(h => h.id_hopital === commande.id_hopital_vendeur);

    const insertResult = await db.query(
        `INSERT INTO drone_telemetry.commandes 
            (id_demandeur, id_fournisseur, groupe_sanguin, quantite, statut_commande, drone_latitude, drone_longitude, drone_batterie, id_commande_metier)
         VALUES ($1, $2, $3, $4, 'EN_VOL', $5, $6, 98, $7)
         RETURNING *;`,
        [
            commande.id_hopital_demandeur,
            commande.id_hopital_vendeur,
            (commande.groupe_sanguin + (commande.rhesus || '')).slice(0, 3),
            commande.quantite || 1,
            depart.latitude,
            depart.longitude,
            commande.id_commande
        ]
    );

    return insertResult.rows[0];
}

// Fait progresser la position simulée du drone d'un pas vers la destination,
// et persiste la nouvelle position/batterie en base à chaque appel (polling
// du frontend toutes les 3 secondes, cf. orders.js).
async function avancerTelemetrie(ligneTelemetrie) {
    if (ligneTelemetrie.statut_commande === 'LIVREE') {
        return ligneTelemetrie; // mission déjà terminée, rien à faire
    }

    const hopitauxResult = await db.query(
        `SELECT id_hopital, latitude, longitude FROM medical_logistics.hopitaux 
         WHERE id_hopital = ANY($1::uuid[])`,
        [[ligneTelemetrie.id_fournisseur, ligneTelemetrie.id_demandeur]]
    );

    const arrivee = hopitauxResult.rows.find(h => h.id_hopital === ligneTelemetrie.id_demandeur);

    if (!arrivee) {
        throw new Error("Coordonnées de l'hôpital demandeur introuvables.");
    }

    // Avance de 15% de la distance restante à chaque appel (convergence
    // géométrique simple, suffisante pour une démonstration).
    const PAS = 0.15;
    const nouvelleLat = parseFloat(ligneTelemetrie.drone_latitude) +
        (parseFloat(arrivee.latitude) - parseFloat(ligneTelemetrie.drone_latitude)) * PAS;
    const nouvelleLng = parseFloat(ligneTelemetrie.drone_longitude) +
        (parseFloat(arrivee.longitude) - parseFloat(ligneTelemetrie.drone_longitude)) * PAS;

    const distanceRestante = Math.hypot(
        parseFloat(arrivee.latitude) - nouvelleLat,
        parseFloat(arrivee.longitude) - nouvelleLng
    );

    const missionTerminee = distanceRestante < 0.0015; // seuil d'arrivée
    const nouvelleBatterie = Math.max(ligneTelemetrie.drone_batterie - 3, 20);

    const updateResult = await db.query(
        `UPDATE drone_telemetry.commandes 
         SET drone_latitude = $1, drone_longitude = $2, drone_batterie = $3,
             statut_commande = $4, date_livraison = CASE WHEN $4 = 'LIVREE' THEN NOW() ELSE date_livraison END
         WHERE id_commande = $5
         RETURNING *;`,
        [
            missionTerminee ? arrivee.latitude : nouvelleLat,
            missionTerminee ? arrivee.longitude : nouvelleLng,
            nouvelleBatterie,
            missionTerminee ? 'LIVREE' : 'EN_VOL',
            ligneTelemetrie.id_commande
        ]
    );

    return updateResult.rows[0];
}
