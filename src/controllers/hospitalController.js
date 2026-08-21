//hospitalController.js
const db = require('../../config/db');

exports.registerHospital = async (req, res) => {
    const { nom, adresse, latitude, longitude, telephone } = req.body;

    if (!nom || !adresse || !latitude || !longitude) {
        return res.status(400).json({ message: "Le nom, l'adresse et les coordonnées GPS sont obligatoires." });
    }

    try {
        const queryText = `
            INSERT INTO medical_logistics.hopitaux (nom, adresse, latitude, longitude, telephone, statut)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const values = [nom, adresse, latitude, longitude, telephone, 'EN_ATTENTE'];
        const result = await db.query(queryText, values);
        
        res.status(201).json({
            message: "Demande d'enregistrement reçue.",
            hopital: result.rows[0]
        });
    } catch (error) {
        console.error("Erreur Enregistrement Hôpital :", error);
        res.status(500).json({ message: "Erreur lors de l'enregistrement de l'hôpital." });
    }
};

exports.getAllHospitals = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM medical_logistics.hopitaux ORDER BY nom ASC');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur Récupération Hôpitaux :", error);
        res.status(500).json({ message: "Impossible de récupérer la liste des hôpitaux." });
    }
};

// Vue d'ensemble des hôpitaux du réseau avec leur stock par groupe sanguin,
// utilisée pour la carte interactive du tableau de bord (marqueurs
// cliquables) et pour le tableau "Stock des hôpitaux affiliés".
//
// CORRECTIF : ne filtrait ni sur le statut de l'hôpital (des établissements
// EN_ATTENTE ou DESACTIVE apparaissaient sur la carte), ni sur la date de
// péremption des poches (des poches périmées gonflaient artificiellement
// les totaux affichés). Exclut également l'hôpital de l'utilisateur
// connecté quand un token est fourni : sur SA PROPRE carte réseau, on ne
// veut voir que les AUTRES établissements affiliés.
exports.getHospitalsOverview = async (req, res) => {
    const idHopitalConnecte = req.user ? req.user.id_hopital : null;

    try {
        const queryText = `
            SELECT 
                h.id_hopital,
                h.nom,
                h.region,
                h.telephone,
                h.latitude,
                h.longitude,
                COALESCE(SUM(p.count_groupe), 0)::int AS total_poches,
                COALESCE(
                    json_object_agg(
                        p.groupe_sanguin, p.count_groupe
                    ) FILTER (WHERE p.groupe_sanguin IS NOT NULL), 
                    '{}'::json
                ) AS stock_details
            FROM medical_logistics.hopitaux h
            LEFT JOIN (
                SELECT id_hopital, groupe_sanguin, COUNT(*)::int AS count_groupe
                FROM medical_logistics.poches_sang
                WHERE statut = 'DISPONIBLE' AND date_peremption >= CURRENT_DATE
                GROUP BY id_hopital, groupe_sanguin
            ) p ON h.id_hopital = p.id_hopital
            WHERE h.statut = 'ACTIF'
              AND h.id_hopital != COALESCE($1, '00000000-0000-0000-0000-000000000000'::uuid)
            GROUP BY h.id_hopital, h.nom, h.region, h.telephone, h.latitude, h.longitude
            ORDER BY h.nom ASC;
        `;

        const result = await db.query(queryText, [idHopitalConnecte]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur getHospitalsOverview:", error);
        res.status(500).json({ message: "Erreur lors du chargement de la vue d'ensemble." });
    }
};