const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, isSuperAdmin } = require('../middlewares/authMiddleware');

router.patch('/hopitaux/:id/valider', verifyToken, isSuperAdmin, adminController.validateHopital);
router.get('/commandes/pending', verifyToken, isSuperAdmin, adminController.getPendingOrders);
router.post('/commandes/arbitrer', verifyToken, isSuperAdmin, adminController.arbitrerCommande);

module.exports = router;