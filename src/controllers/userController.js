// src/controllers/userController.js
const db = require('../../config/db');
const bcrypt = require('bcryptjs');

// Création d'un utilisateur interne par un Admin Hôpital ou Super Admin
exports.createUser = async (req, res) => {
    const { nom, email, password, role } = req.body;
    const currentUser = req.user; // Provient du middleware JWT

    if (!nom || !email || !password) {
        return res.status(400).json({ message: "Le nom, l'email et le mot de passe sont requis." });
    }

    let assignedRole = 'AGENT_HOPITAL';
    let targetHopitalId = currentUser.id_hopital;

    // Contrôle strict des rôles selon l'émetteur
    if (currentUser.role === 'ADMIN_HOPITAL') {
        const rolesAutorises = ['AGENT_HOPITAL', 'GESTIONNAIRE_STOCK'];
        if (role && !rolesAutorises.includes(role)) {
            return res.status(403).json({ message: "Vous n'avez pas la permission d'attribuer ce rôle." });
        }
        assignedRole = role || 'AGENT_HOPITAL';

        // Garde-fou : un ADMIN_HOPITAL dont le compte n'est pas lui-même
        // rattaché à un hôpital (cas anormal) ne doit jamais pouvoir créer
        // un agent avec id_hopital = NULL. Sans ce contrôle, l'agent créé
        // ne verrait jamais aucune donnée (stocks, dons, commandes...)
        // puisque toutes ces routes filtrent par id_hopital.
        if (!targetHopitalId) {
            return res.status(400).json({
                message: "Votre compte n'est rattaché à aucun établissement. Impossible de créer un utilisateur. Contactez un administrateur réseau."
            });
        }
    } else if (currentUser.role === 'SUPER_ADMIN') {
        assignedRole = role || 'ADMIN_HOPITAL';
        targetHopitalId = req.body.id_hopital || null;

        // Un SUPER_ADMIN ne crée un compte sans hôpital que pour un autre
        // SUPER_ADMIN. Pour tout autre rôle, l'hôpital est obligatoire :
        // on refuse explicitement plutôt que d'insérer un id_hopital NULL
        // en silence (c'était la cause du bug "utilisateur non lié").
        if (assignedRole !== 'SUPER_ADMIN' && !targetHopitalId) {
            return res.status(400).json({
                message: "Veuillez sélectionner l'hôpital de rattachement pour ce rôle."
            });
        }

        // Vérifie que l'hôpital indiqué existe réellement, pour éviter une
        // violation de contrainte FK peu explicite en base.
        if (targetHopitalId) {
            const hopitalCheck = await db.query(
                'SELECT id_hopital FROM medical_logistics.hopitaux WHERE id_hopital = $1',
                [targetHopitalId]
            );
            if (hopitalCheck.rows.length === 0) {
                return res.status(400).json({ message: "L'hôpital sélectionné est introuvable." });
            }
        }
    } else {
        return res.status(403).json({ message: "Non autorisé." });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Forcer le changement de mot de passe à la 1ère connexion
        const query = `
            INSERT INTO core_identity.utilisateurs 
                (nom, email, mot_de_passe, role, id_hopital, statut_compte, doit_changer_mdp, date_inscription)
            VALUES ($1, $2, $3, $4, $5, 'ACTIF', true, NOW())
            RETURNING id_utilisateur, nom, email, role, statut_compte;
        `;

        const result = await db.query(query, [nom, email, hashedPassword, assignedRole, targetHopitalId]);

        res.status(201).json({
            message: "Utilisateur créé avec succès.",
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Erreur création utilisateur :", error);
        if (error.code === '23505') {
            return res.status(400).json({ message: "Cet email est déjà utilisé." });
        }
        res.status(500).json({ message: "Erreur lors de la création." });
    }
};

// Basculer le statut d'un utilisateur (Activer / Suspendre)
exports.toggleUserStatus = async (req, res) => {
    const { id } = req.params;
    const { statut } = req.body; // 'ACTIF' ou 'SUSPENDU'

    if (!['ACTIF', 'SUSPENDU'].includes(statut)) {
        return res.status(400).json({ message: "Statut invalide." });
    }

    try {
        const result = await db.query(
            `UPDATE core_identity.utilisateurs 
             SET statut_compte = $1 
             WHERE id_utilisateur = $2 AND id_hopital = $3 
             RETURNING id_utilisateur, statut_compte;`,
            [statut, id, req.user.id_hopital]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }

        res.status(200).json({ message: `Statut mis à jour : ${statut}`, user: result.rows[0] });
    } catch (error) {
        console.error("Erreur mise à jour statut :", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
};