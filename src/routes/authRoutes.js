const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// @route   POST /api/auth/register-hospital
// @desc    Inscription publique d'un hôpital + création de l'Admin Hôpital (en attente)
// @access  Public
router.post('/register-hospital', authController.registerHospital);

// @route   POST /api/auth/login
// @desc    Connexion utilisateur (génération du token JWT)
// @access  Public
router.post('/login', authController.login);    

module.exports = router;