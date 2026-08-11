// src/controllers/settingsController.js
//
// Développé pour répondre au module frontend existant (public/js/modules/settings.js),
// qui attendait deux routes jusque-là inexistantes côté backend :
//   - GET /api/utilisateurs (liste des comptes rattachés à l'hôpital connecté)
//   - PUT /api/hopital/profil (mise à jour des informations de l'hôpital)

const db = require('../../config/db');
const bcrypt = require('bcryptjs');

// 1. LISTE DES UTILISATEURS DE L'HÔPITAL CONNECTÉ
// Un compte hôpital ne doit voir que les utilisateurs de son propre
// établissement, jamais l'ensemble du réseau — d'où le filtre sur id_hopital.
exports.getUsersList = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    if (!id_hopital) {
        // Cas d'un SUPER_ADMIN sans id_hopital : renvoie une liste vide plutôt
        // qu'une erreur, ce module n'étant pas destiné à l'espace Admin.
        return res.status(200).json([]);
    }

    try {
        // NOTE : core_identity.utilisateurs n'a pas de colonne booléenne
        // "actif" — la colonne réelle est statut_compte ('ACTIF'/'SUSPENDU'),
        // conformément à la contrainte chk_utilisateur_statut.
        const result = await db.query(
            `SELECT id_utilisateur, nom, email, role, statut_compte 
             FROM core_identity.utilisateurs
             WHERE id_hopital = $1
             ORDER BY nom ASC;`,
            [id_hopital]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération liste utilisateurs :", error);
        res.status(500).json({ message: "Erreur lors du chargement des utilisateurs." });
    }
};

// 2. METTRE À JOUR LES DROITS / STATUT D'UN UTILISATEUR (bouton "Droits" du frontend)
exports.updateUserRights = async (req, res) => {
    const { id_utilisateur } = req.params;
    const { role, statut_compte } = req.body;
    const id_hopital = req.user.id_hopital;

    if (statut_compte && !['ACTIF', 'SUSPENDU'].includes(statut_compte)) {
        return res.status(400).json({ message: "Statut invalide. Valeurs attendues : ACTIF ou SUSPENDU." });
    }
    if (role && !['SUPER_ADMIN', 'ADMIN_HOPITAL', 'PERSONNEL'].includes(role)) {
        return res.status(400).json({ message: "Rôle invalide." });
    }

    try {
        // Sécurité : on vérifie que l'utilisateur ciblé appartient bien au
        // même hôpital que celui qui fait la demande, pour éviter qu'un
        // ADMIN_HOPITAL ne modifie les droits d'un utilisateur d'un autre établissement.
        const result = await db.query(
            `UPDATE core_identity.utilisateurs
             SET role = COALESCE($1, role), statut_compte = COALESCE($2, statut_compte)
             WHERE id_utilisateur = $3 AND id_hopital = $4
             RETURNING id_utilisateur, nom, email, role, statut_compte;`,
            [role || null, statut_compte || null, id_utilisateur, id_hopital]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Utilisateur introuvable dans votre établissement." });
        }

        res.status(200).json({ message: "Droits mis à jour.", utilisateur: result.rows[0] });
    } catch (error) {
        console.error("Erreur mise à jour droits utilisateur :", error);
        res.status(500).json({ message: "Erreur lors de la mise à jour des droits." });
    }
};

// 3. METTRE À JOUR LE PROFIL DE L'HÔPITAL CONNECTÉ
exports.updateHospitalProfile = async (req, res) => {
    const id_hopital = req.user.id_hopital;
    const { nom_hopital, telephone } = req.body;

    if (!id_hopital) {
        return res.status(403).json({ message: "Cette action est réservée aux comptes hospitaliers." });
    }

    try {
        const result = await db.query(
            `UPDATE medical_logistics.hopitaux
             SET nom = COALESCE($1, nom), telephone = COALESCE($2, telephone)
             WHERE id_hopital = $3
             RETURNING id_hopital, nom, telephone, statut;`,
            [nom_hopital || null, telephone || null, id_hopital]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Hôpital introuvable." });
        }

        res.status(200).json({ message: "Profil mis à jour avec succès.", hopital: result.rows[0] });
    } catch (error) {
        console.error("Erreur mise à jour profil hôpital :", error);
        res.status(500).json({ message: "Erreur lors de la mise à jour du profil." });
    }
};

// 4. LISTE DES ADMINISTRATEURS DU RÉSEAU (vue Admin uniquement)
// GET /api/admin/administrateurs
exports.getAdministrateurs = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id_utilisateur, nom, email, statut_compte, date_inscription
             FROM core_identity.utilisateurs
             WHERE role = 'SUPER_ADMIN'
             ORDER BY date_inscription ASC;`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur récupération administrateurs :", error);
        res.status(500).json({ message: "Erreur lors du chargement des administrateurs." });
    }
};

// 5. CRÉER UN NOUVEL ADMINISTRATEUR (Admin uniquement)
// POST /api/admin/administrateurs
//
// Contrairement à authController.register (route publique, qui bloque
// volontairement la création de SUPER_ADMIN), cette route est protégée par
// isSuperAdmin : seul un Admin déjà authentifié peut en créer un autre.
exports.creerAdministrateur = async (req, res) => {
    const { nom, email, mot_de_passe } = req.body;

    if (!nom || !email || !mot_de_passe) {
        return res.status(400).json({ message: "Le nom, l'email et le mot de passe sont requis." });
    }
    if (mot_de_passe.length < 8) {
        return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères." });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(mot_de_passe, salt);

        const result = await db.query(
            `INSERT INTO core_identity.utilisateurs (nom, email, mot_de_passe, role, id_hopital, date_inscription)
             VALUES ($1, $2, $3, 'SUPER_ADMIN', NULL, NOW())
             RETURNING id_utilisateur, nom, email, role;`,
            [nom, email, hashedPassword]
        );

        res.status(201).json({ message: "Administrateur créé avec succès.", administrateur: result.rows[0] });
    } catch (error) {
        console.error("Erreur création administrateur :", error);
        if (error.code === '23505') {
            return res.status(400).json({ message: "Cet email est déjà utilisé." });
        }
        res.status(500).json({ message: "Erreur lors de la création de l'administrateur." });
    }
};

// 6. CHANGER SON PROPRE MOT DE PASSE (Hôpital ou Admin)
// PUT /api/utilisateurs/mot-de-passe
exports.changerMotDePasse = async (req, res) => {
    const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;
    const id_utilisateur = req.user.id_utilisateur;

    if (!ancien_mot_de_passe || !nouveau_mot_de_passe) {
        return res.status(400).json({ message: "L'ancien et le nouveau mot de passe sont requis." });
    }
    if (nouveau_mot_de_passe.length < 8) {
        return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 8 caractères." });
    }

    try {
        const userResult = await db.query(
            `SELECT mot_de_passe FROM core_identity.utilisateurs WHERE id_utilisateur = $1;`,
            [id_utilisateur]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }

        const isMatch = await bcrypt.compare(ancien_mot_de_passe, userResult.rows[0].mot_de_passe);
        if (!isMatch) {
            return res.status(401).json({ message: "L'ancien mot de passe est incorrect." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(nouveau_mot_de_passe, salt);

        await db.query(
            `UPDATE core_identity.utilisateurs SET mot_de_passe = $1 WHERE id_utilisateur = $2;`,
            [hashedPassword, id_utilisateur]
        );

        res.status(200).json({ message: "Mot de passe modifié avec succès." });
    } catch (error) {
        console.error("Erreur changement mot de passe :", error);
        res.status(500).json({ message: "Erreur lors du changement de mot de passe." });
    }
};
