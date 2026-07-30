const express = require('express');
const router = express.Router();
const pochesController = require('../controllers/pochesController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Route pour déclarer un prélèvement (uniquement pour un hôpital authentifié)
router.post('/enregistrer', verifyToken, pochesController.enregistrerPoche);

// Route pour consulter l'état réel de son stock utilisable
router.get('/mon-stock', verifyToken, pochesController.getStockInterne);

module.exports = router;