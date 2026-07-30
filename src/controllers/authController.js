// src/controllers/authController.js
const db = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. INSCRIPTION D'UN UTILISATEUR (Agent d'hôpital, Admin, etc.)
exports.register = async (req, res) => {
    const { email, password, nom, role, id_hopital } = req.body;

    if (!email || !password || !nom) {
        return res.status(400).json({ message: "Le nom, l'email et le mot de passe sont obligatoires." });
    }

    try {
        // Hachage du mot de passe pour la sécurité
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insertion dans la table des utilisateurs (schéma core_identity)
        const queryText = `
            INSERT INTO core_identity.utilisateurs (nom, email, mot_de_passe, role, id_hopital, date_inscription)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id_utilisateur, nom, email, role;
        `;
        
        const values = [nom, email, hashedPassword, role || 'ADMIN_HOPITAL', id_hopital || null];
        const result = await db.query(queryText, values);

        res.status(201).json({
            message: "Utilisateur créé avec succès.",
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Erreur Inscription :", error);
        if (error.code === '23505') { // Code d'erreur PostgreSQL pour contrainte unique (email existant)
            return res.status(400).json({ message: "Cet email est déjà utilisé." });
        }
        res.status(500).json({ message: "Une erreur est survenue lors de l'inscription." });
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