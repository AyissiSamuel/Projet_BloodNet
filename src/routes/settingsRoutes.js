// src/routes/settingsRoutes.js
//
// Regroupe les routes attendues par public/js/modules/settings.js :
//   - /api/utilisateurs         → gestion des comptes de l'hôpital connecté
//   - /api/hopital/profil       → mise à jour du profil de l'hôpital
//
// NOTE : ce routeur est monté directement sur /api (racine) dans server.js,
// et non sous un préfixe /api/settings, pour respecter exactement les
// chemins déjà appelés par le frontend existant.
const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/utilisateurs', verifyToken, settingsController.getUsersList);
router.patch('/utilisateurs/:id_utilisateur/droits', verifyToken, settingsController.updateUserRights);
router.put('/utilisateurs/mot-de-passe', verifyToken, settingsController.changerMotDePasse);
router.put('/hopital/profil', verifyToken, settingsController.updateHospitalProfile);

module.exports = router;
