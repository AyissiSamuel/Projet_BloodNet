const express = require('express');
const router = express.Router();
const droneService = require('../services/droneSimulationService');
const { verifyToken } = require('../middlewares/authMiddleware');

router.use(verifyToken);

// Récupérer la flotte de drones
router.get('/flotte', (req, res) => {
    res.json(droneService.getFlotte());
});

// Ajouter un drone à la flotte
router.post('/flotte', (req, res) => {
    try {
        const { id, nom } = req.body;
        const drone = droneService.ajouterDrone(id, nom);
        res.status(201).json({ message: "Drone ajouté avec succès.", drone });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Retirer un drone de la flotte
router.delete('/flotte/:id', (req, res) => {
    try {
        droneService.retirerDrone(req.params.id);
        res.json({ message: "Drone retiré de la flotte." });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;