// src/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');

// 1. Vérifie si l'utilisateur est connecté (Token valide)
exports.verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Récupère le token après "Bearer"

    if (!token) {
        return res.status(401).json({ message: "Accès refusé. Token manquant." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'cle_secrete_par_defaut');
        req.user = decoded; // Contient id_utilisateur, role, id_hopital
        next();
    } catch (error) {
        return res.status(403).json({ message: "Token invalide ou expiré." });
    }
};

// 2. Vérifie si le rôle de l'utilisateur fait partie des rôles autorisés
exports.checkRole = (rolesAutorises = []) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ message: "Utilisateur non authentifié." });
        }

        if (!rolesAutorises.includes(req.user.role)) {
            return res.status(403).json({ 
                message: "Accès interdit. Vous n'avez pas les privilèges requis." 
            });
        }

        next();
    };
};

// 3. Vérifie si l'utilisateur est spécifiquement un SUPER_ADMIN
exports.isSuperAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'SUPER_ADMIN') {
        next();
    } else {
        return res.status(403).json({ message: "Accès interdit. Privilèges Super Admin requis." });
    }
};