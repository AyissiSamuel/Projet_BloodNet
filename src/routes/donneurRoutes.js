// src/routes/donneurRoutes.js
const express = require('express');
const router = express.Router();
const donneurController = require('../controllers/donneurController');
const { verifyToken } = require('../middlewares/authMiddleware'); // Sécurisé par défaut

// Liste complète des donneurs
router.get('/', verifyToken, donneurController.getAllDonneurs);

// Route pour enregistrer un donneur seul (sans don immédiat)
router.post('/register', verifyToken, donneurController.registerDonneur);

// Route fusionnée attendue par le frontend : donneur + don en une seule requête
router.post('/enregistrer', verifyToken, donneurController.enregistrerDonEtDonneur);

// Route de recherche urgente (Accessible par le personnel connecté)
router.get('/search', verifyToken, donneurController.searchDonneurs);

// Historique global des dons (toutes structures confondues)
router.get('/historique-dons', verifyToken, donneurController.getHistoriqueGlobal);

// Route pour consulter l'historique d'un donneur précis
router.get('/:id_donneur/historique', verifyToken, donneurController.getHistoriqueDonneur);

// NEW: Envoi de SMS à un donneur (réservé aux ADMIN_HOPITAL)
router.post('/:id/send-sms', verifyToken, donneurController.sendSmsToDonor);

module.exports = router;
