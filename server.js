// server.js
require('dotenv').config();
require('./src/jobs/cronTasks');
const express = require('express');
const morgan = require('morgan');
const http = require('http');
const path = require('path');
const socketConfig = require('./config/socket');

const db = require('./config/db');

const app = express();
const server = http.createServer(app);


// Initialisation du temps réel (Socket.io)
const io = socketConfig.init(server);

// Middlewares pour comprendre le JSON envoyé par le client
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques de l'interface (HTML/CSS)
app.use(express.static(path.join(__dirname, 'public')));

// IMPORTATION ET LIAISON DES ROUTES API
const authRoutes = require('./src/routes/authRoutes');
app.use('/api/auth', authRoutes);
const userRoutes = require('./src/routes/userRoutes');
app.use('/api/utilisateurs', userRoutes);
const hospitalRoutes = require('./src/routes/hospitalRoutes');
app.use('/api/hospitals', hospitalRoutes);
const stockRoutes = require('./src/routes/stockRoutes');
app.use('/api/stocks', stockRoutes);
const dashboardRoutes = require('./src/routes/dashboardRoutes');
app.use('/api/dashboard', dashboardRoutes);
const donneurRoutes = require('./src/routes/donneurRoutes');
app.use('/api/donneurs', donneurRoutes);
const sosRoutes = require('./src/routes/sosRoutes');
app.use('/api/sos', sosRoutes);
const commandeRoutes = require('./src/routes/commandeRoutes');
app.use('/api/commandes', commandeRoutes);
const droneRoutes = require('./src/routes/droneRoutes');
app.use('/api/drones', droneRoutes);
const adminRoutes = require('./src/routes/adminRoutes');
app.use('/api/admin', adminRoutes);
const pochesRoutes = require('./src/routes/pochesRoutes');
app.use('/api/poches', pochesRoutes);
const settingsRoutes = require('./src/routes/settingsRoutes');
app.use('/api', settingsRoutes);
const predictionRoutes = require('./src/routes/predictionRoutes');
app.use('/api/predictions', predictionRoutes);



app.use((err, req, res, next) => {
    console.error('[ERREUR NON GÉRÉE]', err);
    res.status(err.status || 500).json({
        message: err.message || "Une erreur interne est survenue. Veuillez réessayer."
    });
});

// Route 404 générique pour les appels d'API inconnus
app.use('/api', (req, res) => {
    res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} introuvable.` });
});

// Démarrage du serveur
const bonjour = require('bonjour')();
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur BloodNet en ligne sur le port ${PORT}`);

    // Diffusion automatique du serveur sur le réseau local
    const service = bonjour.publish({
        name: 'BloodNet',
        type: 'http',
        port: PORT
    });

    console.log('BloodNet est détectable sur le réseau local.');
});