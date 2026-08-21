// src/routes/hospitalRoutes.js
const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospitalController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Route pour enregistrer un hôpital (publique : c'est la demande d'adhésion initiale)
router.post('/register', hospitalController.registerHospital);

// Route pour l'historique/liste des hôpitaux — protégée
router.get('/all', verifyToken, hospitalController.getAllHospitals);

// src/routes/hospitalRoutes.js
router.get('/overview', verifyToken, hospitalController.getHospitalsOverview);

module.exports = router;