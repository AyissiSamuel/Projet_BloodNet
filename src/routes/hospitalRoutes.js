// src/routes/hospitalRoutes.js
const express = require('express');
const router = express.Router();
const hospitalController = require('../controllers/hospitalController');

// Route pour enregistrer un hôpital
router.post('/register', hospitalController.registerHospital);

// Route pour l'historique/liste des hôpitaux
router.get('/all', hospitalController.getAllHospitals);

module.exports = router;