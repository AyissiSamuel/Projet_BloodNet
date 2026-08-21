// src/routes/dashboardRoutes.js
//
// Route dédiée à GET /api/dashboard/kpis, appelée par
// public/js/modules/stock.js (fetchDashboardKPIs) pour peupler les 4
// cartes KPI du tableau de bord. N'était montée nulle part avant
// correction (404 systématique, KPI toujours affichés à "--").
const express = require('express');
const router = express.Router();
const pochesController = require('../controllers/pochesController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.get('/kpis', verifyToken, pochesController.getDashboardKPIs);

module.exports = router;
