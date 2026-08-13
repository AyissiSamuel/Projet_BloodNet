// src/routes/stockRoutes.js
const express = require('express');
const router = express.Router();
const pochesController = require('../controllers/pochesController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Changement de PUT /update vers POST /enregistrer
router.post('/enregistrer', verifyToken, pochesController.enregistrerPoche);

// Routes de consultation
router.get('/my-stock', verifyToken, pochesController.getStockInterne);
router.get('/search', verifyToken, pochesController.searchUrgentBlood);
router.get('/aggregated', verifyToken, pochesController.getStockAggregatedWithVolume);
router.get('/network', verifyToken, pochesController.getReseauHopitaux);
router.get('/historique', verifyToken, pochesController.getHistoriqueStock);

// Route de déstockage FIFO
router.patch('/utiliser', verifyToken, pochesController.utiliserPocheParGroupe);

module.exports = router;
