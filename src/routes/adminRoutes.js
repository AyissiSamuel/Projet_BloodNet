const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const supervisionController = require('../controllers/supervisionController');
const settingsController = require('../controllers/settingsController');
const { verifyToken, isSuperAdmin } = require('../middlewares/authMiddleware');

console.log('verifyToken:', typeof verifyToken);
console.log('isSuperAdmin:', typeof isSuperAdmin);
console.log('validateHopital:', typeof adminController.validateHopital);
console.log('desactiverHopital:', typeof adminController.desactiverHopital);
console.log('getHopitauxEnAttente:', typeof adminController.getHopitauxEnAttente);
console.log('getPendingOrders:', typeof adminController.getPendingOrders);
console.log('arbitrerCommande:', typeof adminController.arbitrerCommande);
console.log('getSupervisionRegionale:', typeof supervisionController?.getSupervisionRegionale);
console.log('getAdministrateurs:', typeof settingsController?.getAdministrateurs);

router.patch('/hopitaux/:id/valider', verifyToken, isSuperAdmin, adminController.validateHopital);
router.patch('/hopitaux/:id/desactiver', verifyToken, isSuperAdmin, adminController.desactiverHopital);
router.get('/hopitaux/en-attente', verifyToken, isSuperAdmin, adminController.getHopitauxEnAttente);
router.get('/commandes/pending', verifyToken, isSuperAdmin, adminController.getPendingOrders);
router.post('/commandes/arbitrer', verifyToken, isSuperAdmin, adminController.arbitrerCommande);

// Supervision régionale (stock)
router.get('/supervision', verifyToken, isSuperAdmin, supervisionController.getSupervisionRegionale);
router.get('/hopital/:id/stock', verifyToken, isSuperAdmin, supervisionController.getStockHopital);

// Vue dédiée "Hôpitaux par zone" (activité générale, distincte du stock)
router.get('/hopitaux/activite', verifyToken, isSuperAdmin, supervisionController.getActiviteHopitaux);

// Carte réseau (tous les établissements, avec coordonnées et résumé de stock)
router.get('/carte-reseau', verifyToken, isSuperAdmin, supervisionController.getCarteReseau);

// Gestion des comptes administrateurs (vue Paramètres Admin)
router.get('/administrateurs', verifyToken, isSuperAdmin, settingsController.getAdministrateurs);
router.post('/administrateurs', verifyToken, isSuperAdmin, settingsController.creerAdministrateur);

module.exports = router;