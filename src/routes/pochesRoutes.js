const express = require('express');
const router = express.Router();
const pochesController = require('../controllers/pochesController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Route pour déclarer un prélèvement (uniquement pour un hôpital authentifié)
router.post('/enregistrer', verifyToken, pochesController.enregistrerPoche);

// Route pour consulter l'état réel de son stock utilisable (détail poche par poche)
router.get('/mon-stock', verifyToken, pochesController.getStockInterne);

// Route pour consulter le stock agrégé par groupe sanguin + composant
router.get('/agrege', verifyToken, pochesController.getStockAgrege);

// Route pour rechercher du sang disponible dans le réseau (hors son propre hôpital)
router.get('/recherche-urgente', verifyToken, pochesController.searchUrgentBlood);

// Route pour marquer une poche comme utilisée (déstockage)
router.patch('/utiliser', verifyToken, pochesController.utiliserPocheParGroupe);

// Route pour consulter la traçabilité des poches déjà déstockées
router.get('/utilisees', verifyToken, pochesController.getPochesUtilisees);

module.exports = router;