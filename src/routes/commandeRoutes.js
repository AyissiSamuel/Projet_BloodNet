const express = require('express');
const router = express.Router();
const commandeController = require('../controllers/commandeController');
const { verifyToken } = require('../middlewares/authMiddleware');
const actionLogger = require('../middlewares/loggerMiddleware');
router.use(verifyToken);
router.use(actionLogger);

router.post('/passer', verifyToken, commandeController.passerCommande);
router.get('/mes-commandes', verifyToken, commandeController.getMyCommandes);

module.exports = router;