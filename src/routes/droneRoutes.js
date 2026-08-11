// src/routes/droneRoutes.js
const express = require('express');
const router = express.Router();
const commandeController = require('../controllers/commandeController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/telemetrie/:id_commande', verifyToken, commandeController.getTelemetrieCommande);

module.exports = router;
