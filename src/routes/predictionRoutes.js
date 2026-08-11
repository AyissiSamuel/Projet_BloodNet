// src/routes/predictionRoutes.js
const express = require('express');
const router = express.Router();
const predictionController = require('../controllers/predictionController');
const { verifyToken, isSuperAdmin } = require('../middlewares/authMiddleware');

// Vue hôpital : prédiction de rupture et de surplus à risque pour son propre stock
router.get('/stock', verifyToken, predictionController.getPredictionHopital);

// Vue réseau consolidée + suggestions de transfert (réservée à l'Admin)
router.get('/reseau', verifyToken, isSuperAdmin, predictionController.getPredictionReseau);

// Alertes générées quotidiennement par le cron de prédiction (cf. cronTasks.js)
router.get('/alertes', verifyToken, predictionController.getAlertesHopital);
router.get('/alertes/reseau', verifyToken, isSuperAdmin, predictionController.getAlertesReseau);
router.patch('/alertes/:id_alerte/lue', verifyToken, predictionController.marquerAlerteLue);

module.exports = router;
