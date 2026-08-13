const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const settingsController = require('../controllers/settingsController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// Application du middleware d'authentification sur toutes les routes ci-dessous
router.use(verifyToken);

// @route   GET /api/utilisateurs
// @desc    Lister les utilisateurs rattachés à l'hôpital connecté
// @access  Privé
// NOTE : déclarée explicitement ici (et non plus laissée au fallthrough vers
// settingsRoutes.js, qui montait la même route ailleurs) pour que le
// routage de /api/utilisateurs reste lisible et centralisé dans un seul fichier.
router.get('/', settingsController.getUsersList);

// @route   POST /api/utilisateurs
// @desc    Créer un utilisateur interne (Agent, Gestionnaire ou Admin)
// @access  Privé (ADMIN_HOPITAL, SUPER_ADMIN)
router.post(
    '/', 
    checkRole(['ADMIN_HOPITAL', 'SUPER_ADMIN']), 
    userController.createUser
);

// @route   PATCH /api/utilisateurs/:id/statut
// @desc    Activer ou Suspendre le compte d'un utilisateur
// @access  Privé (ADMIN_HOPITAL, SUPER_ADMIN)
router.patch(
    '/:id/statut', 
    checkRole(['ADMIN_HOPITAL', 'SUPER_ADMIN']), 
    userController.toggleUserStatus
);

module.exports = router;