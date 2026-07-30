const express = require('express');
const router = express.Router();
const sosController = require('../controllers/sosController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/lancer', verifyToken, sosController.createSOS);
router.get('/actifs', verifyToken, sosController.getActiveSOS);

module.exports = router;