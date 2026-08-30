1| // src/routes/donneurRoutes.js
2| const express = require('express');
3| const router = express.Router();
4| const donneurController = require('../controllers/donneurController');
5| const { verifyToken } = require('../middlewares/authMiddleware'); // Sécurisé par défaut
6| 
7| // Liste complète des donneurs
8| router.get('/', verifyToken, donneurController.getAllDonneurs);
9| 
10| // Route pour enregistrer un donneur seul (sans don immédiat)
11| router.post('/register', verifyToken, donneurController.registerDonneur);
12| 
13| // Route fusionnée attendue par le frontend : donneur + don en une seule requête
14| router.post('/enregistrer', verifyToken, donneurController.enregistrerDonEtDonneur);
15| 
16| // Route de recherche urgente (Accessible par le personnel connecté)
17| router.get('/search', verifyToken, donneurController.searchDonneurs);
18| 
19| // Historique global des dons (toutes structures confondues)
20| router.get('/historique-dons', verifyToken, donneurController.getHistoriqueGlobal);
21| 
22| // Route pour consulter l'historique d'un donneur précis
23| router.get('/:id_donneur/historique', verifyToken, donneurController.getHistoriqueDonneur);
24| 
25| // NEW: Envoi de SMS à un donneur (réservé aux ADMIN_HOPITAL)
26| router.post('/:id/send-sms', verifyToken, donneurController.sendSmsToDonor);
27| 
28| module.exports = router;
