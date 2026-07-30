const db = require('../../config/db');
const socketConfig = require('../../config/socket');

// 1. CRÉER UN APPEL SOS (DURGENCES) GLOBALES
exports.createSOS = async (req, res) => {
    const { groupe_sanguin, rhesus, quantite_demandee, description } = req.body;
    const id_hopital_demandeur = req.user.id_hopital;

    if (!groupe_sanguin || !rhesus || !quantite_demandee) {
        return res.status(400).json({ message: "Le groupe, le rhésus et la quantité sont requis pour lancer un SOS." });
    }

    try { 
        const queryText = `
            INSERT INTO medical_logistics.sos_urgences (id_hopital_demandeur, groupe_sanguin, rhesus, quantite_demandee, description, statut, date_creation)
            VALUES ($1, UPPER($2), $3, $4, $5, 'ACTIF', NOW())
            RETURNING *;
        `;
        
        const result = await db.query(queryText, [
            id_hopital_demandeur,
            groupe_sanguin,
            rhesus,
            quantite_demandee,
            description || "Urgence vitale : besoin de poches de sang rapidement !"
        ]);

        const nouveauSOS = result.rows[0];

        // Récupérer le nom de l'hôpital émetteur pour personnaliser la notification
        const hopitalInfo = await db.query('SELECT nom FROM medical_logistics.hopitaux WHERE id_hopital = $1', [id_hopital_demandeur]);
        nouveauSOS.nom_hopital_demandeur = hopitalInfo.rows[0]?.nom || "Un hôpital partenaire";

        // ⚡ DIFFUSION TEMPS RÉEL : Tout le réseau des hôpitaux reçoit le SOS
        const io = socketConfig.getIO();
        io.to('sos_global_room').emit('nouvelle_alerte_sos', {
            message: ` ALERTE SOS : ${nouveauSOS.nom_hopital_demandeur} a besoin de ${quantite_demandee} poche(s) de ${groupe_sanguin.toUpperCase()}${rhesus} !`,
            sos: nouveauSOS
        });

        res.status(201).json({
            message: "Appel SOS publié et diffusé sur l'ensemble du réseau local !",
            sos: nouveauSOS
        });

    } catch (error) {
        console.error("Erreur Création SOS :", error);
        res.status(500).json({ message: "Une erreur est survenue lors du lancement du SOS." });
    }
};

// 2. RÉCUPÉRER TOUS LES SOS ACTIFS SUR LE RÉSEAU
exports.getActiveSOS = async (req, res) => {
    try {
        const queryText = `
            SELECT s.*, h.nom AS nom_hopital_demandeur, h.telephone 
            FROM medical_logistics.sos_urgences s
            INNER JOIN medical_logistics.hopitaux h ON s.id_hopital_demandeur = h.id_hopital
            WHERE s.statut = 'ACTIF'
            ORDER BY s.date_creation DESC;
        `;
        const result = await db.query(queryText);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur Récupération SOS :", error);
        res.status(500).json({ message: "Impossible de charger le flux des SOS." });
    }
};