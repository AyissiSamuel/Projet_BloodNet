const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

module.exports = {
    init: (server) => {
        io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST", "PUT"]
            }
        });

        // Middleware Socket.io pour décoder le Token au moment de la connexion
        io.use((socket, next) => {
            const token = socket.handshake.auth.token || socket.handshake.headers['authorization'];
            
            if (!token) {
                return next(new Error("Authentification nécessaire pour le WebSocket."));
            }

            try {
                const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
                const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
                socket.user = decoded;
                next();
            } catch (err) {
                return next(new Error("Token de session expiré ou invalide."));
            }
        });

        io.on('connection', (socket) => {
            console.log(`🔌 Connexion temps réel établie : ${socket.user.role} (Hôpital: ${socket.user.id_hopital || 'aucun'})`);

            // 1. Rejoindre automatiquement sa room privée
            if (socket.user.id_hopital) {
                const privateRoom = `hospital_${socket.user.id_hopital}`;
                socket.join(privateRoom);
                console.log(`🏥 Hôpital connecté à son espace sécurisé : ${privateRoom}`);
            }

            // 2. Rejoindre automatiquement le canal global des SOS
            socket.join('sos_global_room');

            socket.on('disconnect', () => {
                console.log('❌ Déconnexion temps réel.');
            });
        });

        return io;
    },
    getIO: () => {
        if (!io) throw new Error("Socket.io non initialisé !");
        return io;
    }
};