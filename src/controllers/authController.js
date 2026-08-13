// src/controllers/authController.js
const db = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. INSCRIPTION PUBLIQUE : Établissement + Admin Hôpital référent
exports.registerHospital = async (req, res) => {
    const { nom_hopital, region, telephone, nom_admin, email, mot_de_passe, adresse, latitude, longitude } = req.body;

    if (!nom_hopital || !nom_admin || !email || !mot_de_passe) {
        return res.status(400).json({ message: "Tous les champs obligatoires doivent être renseignés." });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // Création de l'hôpital avec coordonnées GPS
        const insertHopitalQuery = `
            INSERT INTO medical_logistics.hopitaux (nom, region, telephone, adresse, latitude, longitude, statut)
            VALUES ($1, $2, $3, $4, $5, $6, 'EN_ATTENTE')
            RETURNING id_hopital;
        `;
        const hopitalRes = await client.query(insertHopitalQuery, [
            nom_hopital, 
            region || null, 
            telephone || null,
            adresse || null,
            latitude || null,
            longitude || null
        ]);
        const targetHopitalId = hopitalRes.rows[0].id_hopital;

        // Création de l'administrateur de l'établissement
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(mot_de_passe, salt);

        const insertUserQuery = `
            INSERT INTO core_identity.utilisateurs 
                (nom, email, mot_de_passe, role, id_hopital, statut_compte, date_inscription)
            VALUES ($1, $2, $3, 'ADMIN_HOPITAL', $4, 'EN_ATTENTE', NOW())
            RETURNING id_utilisateur, nom, email, role, id_hopital, statut_compte;
        `;

        const userRes = await client.query(insertUserQuery, [nom_admin, email, hashedPassword, targetHopitalId]);

        await client.query('COMMIT');

        res.status(201).json({
            message: "Demande d'inscription enregistrée. En attente de validation par l'administration.",
            user: userRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erreur Inscription Hôpital :", error);
        if (error.code === '23505') {
            return res.status(400).json({ message: "Cet email est déjà utilisé." });
        }
        res.status(500).json({ message: "Une erreur est survenue lors de l'inscription." });
    } finally {
        client.release();
    }
};
// 2. CONNEXION (Génération du JWT)
exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Veuillez fournir un email et un mot de passe." });
    }

    try {
        // Rechercher l'utilisateur par son email
        const result = await db.query('SELECT * FROM core_identity.utilisateurs WHERE LOWER(email) = LOWER($1)', [email]);        
        
        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Identifiants invalides." });
        }

        const user = result.rows[0];

        // Vérifier si le mot de passe correspond
        const isMatch = await bcrypt.compare(password, user.mot_de_passe);
        if (!isMatch) {
            return res.status(401).json({ message: "Identifiants invalides." });
        }

        // Création du jeton JWT
        const token = jwt.sign(
            { 
                id_utilisateur: user.id_utilisateur, 
                role: user.role,
                id_hopital: user.id_hopital 
            },
            process.env.JWT_SECRET || 'cle_secrete_par_defaut',
            { expiresIn: '30d' }
        );

        // ✅ EMPLACEMENT CORRECT : 'user' est bien défini et le mot de passe est validé
        console.log(`[AUTH] Connexion réussie : Utilisateur ${user.email} (ID: ${user.id_utilisateur}) à ${new Date().toLocaleString()}`);

        res.status(200).json({
            message: "Connexion réussie !",
            token: token,
            user: {
                id_utilisateur: user.id_utilisateur,
                nom: user.nom,
                email: user.email,
                role: user.role,
                id_hopital: user.id_hopital
            }
        });
    } catch (error) {
        console.error("Erreur Login :", error);
        res.status(500).json({ message: "Une erreur est survenue lors de la connexion." });
    }
};

// 3. DÉCONNEXION
exports.logout = async (req, res) => {
    const userId = req.user ? (req.user.id_utilisateur || req.user.id) : 'Inconnu';
    
    console.log(`[AUTH] Déconnexion : Utilisateur ID ${userId} à ${new Date().toLocaleString()}`);

    res.status(200).json({ message: "Déconnexion enregistrée." });
};