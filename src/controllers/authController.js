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
        // Rechercher l'utilisateur par son email, avec le nom de son hôpital
        // (nécessaire pour l'affichage dynamique côté frontend — auparavant
        // absent de la réponse, ce qui laissait le nom "Hôpital Central de
        // Yaoundé" codé en dur dans index.html s'afficher pour tout le monde).
        const result = await db.query(
            `SELECT u.*, h.nom AS nom_hopital
             FROM core_identity.utilisateurs u
             LEFT JOIN medical_logistics.hopitaux h ON u.id_hopital = h.id_hopital
             WHERE LOWER(u.email) = LOWER($1)`,
            [email]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Identifiants invalides." });
        }

        const user = result.rows[0];

        // Vérifier si le mot de passe correspond
        const isMatch = await bcrypt.compare(password, user.mot_de_passe);
        if (!isMatch) {
            return res.status(401).json({ message: "Identifiants invalides." });
        }

        // Bloque l'accès tant que le compte n'est pas ACTIF. Jusqu'ici,
        // aucune vérification n'était faite : un compte encore EN_ATTENTE
        // (hôpital pas encore validé par l'Admin) ou SUSPENDU (rejeté /
        // désactivé) pouvait se connecter normalement, ce qui rendait les
        // actions "Valider / Rejeter / Désactiver" de l'espace Admin sans
        // effet réel sur l'accès à la plateforme.
        if (user.role !== 'SUPER_ADMIN' && user.statut_compte !== 'ACTIF') {
            const messages = {
                EN_ATTENTE: "Votre établissement est en attente de validation par l'administration. Vous serez notifié dès l'activation de votre compte.",
                SUSPENDU: "Votre compte a été suspendu. Contactez l'administration pour plus d'informations."
            };
            return res.status(403).json({
                message: messages[user.statut_compte] || "Votre compte n'est pas actif."
            });
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
                id_hopital: user.id_hopital,
                nom_hopital: user.nom_hopital || null
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