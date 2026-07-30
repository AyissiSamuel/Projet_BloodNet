// src/controllers/donneurController.js
const db = require('../../config/db');

// 1. Enregistrer un nouveau donneur
exports.registerDonneur = async (req, res) => {
    const { nom, telephone, email, groupe_sanguin, date_dernier_don } = req.body;

    // Validation des champs obligatoires selon votre structure
    if (!nom || !telephone || !groupe_sanguin) {
        return res.status(400).json({ message: "Le nom, le téléphone et le groupe sanguin sont requis." });
    }

    try {
        const queryText = `
            INSERT INTO medical_logistics.donneurs (nom, telephone, email, groupe_sanguin, date_dernier_don)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        
        // On force le groupe sanguin en majuscules pour passer le CHECK (ex: 'o+' -> 'O+')
        const values = [nom, telephone, email || null, groupe_sanguin.toUpperCase(), date_dernier_don || null];
        const result = await db.query(queryText, values);
        
        res.status(201).json({
            message: "Donneur enregistré avec succès.",
            donneur: result.rows[0]
        });
    } catch (error) {
        console.error("Erreur Enregistrement Donneur :", error);
        
        // Gestion des violations de contraintes PostgreSQL
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
    const { groupe_sanguin } = req.query; // Récupération via ?groupe_sanguin=O-

    try {
        let queryText = 'SELECT id_donneur, nom, telephone, email, groupe_sanguin, date_dernier_don FROM medical_logistics.donneurs WHERE statut_eligibilite = true';
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

// Enregistrer un nouveau don avec vérification d'éligibilité (Intervalle de 8 semaines)
exports.registrarDon = async (req, res) => {
    const { id_donneur, volume_ml, remarques } = req.body;
    const id_hopital = req.user.id_hopital; // Extrait du token JWT de l'infirmier/médecin connecté

    if (!id_donneur) {
        return res.status(400).json({ message: "L'identifiant du donneur est requis." });
    }

    try {
        // 1. Récupérer les informations du donneur (notamment son groupe sanguin)
        const donneurCheck = await db.query(
            `SELECT groupe_sanguin FROM medical_logistics.donneurs WHERE id_donneur = $1`,
            [id_donneur]
        );

        if (donneurCheck.rows.length === 0) {
            return res.status(404).json({ message: "Donneur introuvable." });
        }

        const groupeSanguin = donneurCheck.rows[0].groupe_sanguin;

        // 2. Vérifier la date du tout dernier don de ce donneur
        const dernierDonCheck = await db.query(
            `SELECT date_don FROM medical_logistics.historique_dons 
             WHERE id_donneur = $1 
             ORDER BY date_don DESC LIMIT 1`,
            [id_donneur]
        );

        if (dernierDonCheck.rows.length > 0) {
            const dateDernierDon = new Date(dernierDonCheck.rows[0].date_don);
            const dateActuelle = new Date();
            
            // Calcul de la différence en jours
            const differenceEnTemps = dateActuelle.getTime() - dateDernierDon.getTime();
            const differenceEnJours = Math.floor(differenceEnTemps / (1000 * 3600 * 24));

            // Règle médicale : 8 semaines = 56 jours
            if (differenceEnJours < 56) {
                return res.status(400).json({ 
                    message: `Le donneur n'est pas encore éligible. Son dernier don remonte à ${differenceEnJours} jours. Le délai minimum est de 56 jours (8 semaines).`,
                    jours_restants: 56 - differenceEnJours
                });
            }
        }

        // 3. Si le donneur est éligible, on démarre une transaction pour enregistrer le don et mettre à jour les stocks
        await db.query('BEGIN');

        // Insérer dans l'historique
        const nouveauDon = await db.query(
            `INSERT INTO medical_logistics.historique_dons (id_donneur, id_hopital_prelevement, volume_ml, remarques)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [id_donneur, id_hopital, volume_ml || 450, remarques]
        );

        // Créditer automatiquement le stock de l'hôpital d'une poche (+1) pour ce groupe sanguin
        await db.query(
            `INSERT INTO medical_logistics.stocks (id_hopital, groupe_sanguin, quantite)
             VALUES ($1, $2, 1)
             ON CONFLICT (id_hopital, groupe_sanguin) 
             DO UPDATE SET quantite = medical_logistics.stocks.quantite + 1`,
            [id_hopital, groupeSanguin]
        );

        await db.query('COMMIT');

        res.status(201).json({
            message: "Don enregistré avec succès ! Le stock de l'établissement a été incrémenté.",
            don: nouveauDon.rows[0]
        });

    } catch (error) {
        await db.query('ROLLBACK');
        console.error("Erreur enregistrement don :", error);
        res.status(500).json({ message: "Erreur interne lors de la validation du don." });
    }
};

// Obtenir l'historique des dons d'un donneur spécifique
exports.getHistoriqueDonneur = async (req, res) => {
    const { id_donneur } = req.params;

    try {
        const result = await db.query(
            `SELECT h.*, hop.nom as nom_hopital 
             FROM medical_logistics.historique_dons h
             JOIN public.hopitaux hop ON h.id_hopital_prelevement = hop.id_hopital
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