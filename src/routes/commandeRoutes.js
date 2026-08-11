const express = require('express');
const router = express.Router();
const commandeController = require('../controllers/commandeController');
const { verifyToken } = require('../middlewares/authMiddleware');
const actionLogger = require('../middlewares/loggerMiddleware');
router.use(verifyToken);
router.use(actionLogger);

// Route historique (conservée pour compatibilité avec le cahier des charges)
router.post('/passer', commandeController.passerCommande);

// Alias attendu par le frontend actuel
router.post('/creer', commandeController.creerCommande);

// Liste des commandes, avec filtrage optionnel ?type=emises|recues
router.get('/mes-commandes', commandeController.getMyCommandes);
router.get('/', commandeController.getMyCommandes); // alias : GET /api/commandes?type=...

// Télémétrie simulée du drone pour une commande en cours de livraison
router.get('/telemetrie/:id_commande', commandeController.getTelemetrieCommande);

module.exports = router;