// src/routes/donneurRoutes.js
const express = require('express');
const router = express.Router();
const donneurController = require('../controllers/donneurController');
const {verifyToken} = require('../middlewares/authMiddleware'); // Sécurisé par défaut

// Route pour enregistrer un donneur (Accessible uniquement par le personnel connecté)
router.post('/register', verifyToken, donneurController.registerDonneur);

// Route de recherche urgente (Accessible par le personnel connecté)
router.get('/search', verifyToken, donneurController.searchDonneurs);

// Route pour consulter l'historique d'un donneur
router.get('/:id_donneur/historique', verifyToken, donneurController.getHistoriqueDonneur);
module.exports = router;