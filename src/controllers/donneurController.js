// src/controllers/donneurController.js
const db = require('../../config/db');
const smsService = require('../services/smsService');

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
            nom,
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

// 3. Liste des donneurs AYANT DÉJÀ DONNÉ DANS L'HÔPITAL CONNECTÉ (attendue
// par le frontend : GET /api/donneurs)
//
// CORRECTIF : cette liste était auparavant globale (tous les donneurs de
// toutes les structures, sans filtre), car la table medical_logistics.donneurs
// n'a pas de colonne id_hopital — un donneur est une entité indépendante,
// seul son historique de dons (historique_dons.id_hopital_prelevement) est
// rattaché à un établissement précis. On restreint donc désormais la liste
// aux donneurs ayant au moins un don enregistré dans l'hôpital connecté
// (INNER JOIN sur historique_dons filtré par hôpital), et les compteurs
// total_dons / dernier_don ne portent eux aussi que sur cet hôpital — pas
// sur l'activité globale du donneur dans tout le réseau.
exports.getAllDonneurs = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    if (!id_hopital) {
        // Compte sans hôpital rattaché (ex. SUPER_ADMIN) : cette vue n'a pas
        // de sens à l'échelle réseau ici, on renvoie une liste vide plutôt
        // qu'un mélange de tous les hôpitaux.
        return res.status(200).json([]);
    }

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
                COUNT(h.id_don) AS total_dons,
                MAX(h.date_don) AS dernier_don
             FROM medical_logistics.donneurs d
             INNER JOIN medical_logistics.historique_dons h 
                ON h.id_donneur = d.id_donneur AND h.id_hopital_prelevement = $1
             GROUP BY d.id_donneur, d.nom, d.telephone, d.email, d.groupe_sanguin, d.est_anonyme, d.statut_eligibilite
             ORDER BY dernier_don DESC NULLS LAST;`,
            [id_hopital]
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

// 6. Historique des dons DE L'HÔPITAL CONNECTÉ (attendu par le frontend :
// GET /api/donneurs/historique-dons)
//
// CORRECTIF : renvoyait auparavant l'historique de TOUS les hôpitaux
// confondus (aucun filtre). Restreint désormais à id_hopital_prelevement =
// hôpital connecté, cohérent avec getAllDonneurs ci-dessus.
exports.getHistoriqueGlobal = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    if (!id_hopital) {
        return res.status(200).json([]);
    }

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
             WHERE h.id_hopital_prelevement = $1
             ORDER BY h.date_don DESC
             LIMIT 100;`,
            [id_hopital]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération historique donneurs :", error);
        res.status(500).json({ message: "Impossible de récupérer l'historique des dons." });
    }
};

// 7. Envoi de SMS à un donneur (action réservée aux ADMIN_HOPITAL)
exports.sendSmsToDonor = async (req, res) => {
    const donorId = req.params.id;
    const { message } = req.body || {};

    // Autorisation : seul le rôle ADMIN_HOPITAL peut envoyer des SMS via la plateforme
    if (!req.user || req.user.role !== 'ADMIN_HOPITAL') {
        return res.status(403).json({ message: 'Accès non autorisé.' });
    }

    if (!message || message.trim().length === 0) {
        return res.status(400).json({ message: 'Le message est requis.' });
    }

    try {
        const result = await db.query('SELECT telephone, nom FROM medical_logistics.donneurs WHERE id_donneur = $1', [donorId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Donneur introuvable.' });
        }

        const { telephone, nom } = result.rows[0];
        if (!telephone || telephone.startsWith('ANONYME')) {
            return res.status(400).json({ message: 'Numéro de téléphone indisponible pour ce donneur.' });
        }

        const sendResult = await smsService.sendSMS(telephone, message);
        if (sendResult.success) {
            return res.status(200).json({ message: 'SMS envoyé avec succès.' });
        } else {
            console.error('Erreur envoi SMS:', sendResult.error);
            return res.status(500).json({ message: sendResult.error || 'Erreur lors de l\'envoi du SMS.' });
        }
    } catch (err) {
        console.error('Erreur sendSmsToDonor:', err);
        return res.status(500).json({ message: 'Erreur serveur lors de l\'envoi du SMS.' });
    }
};
