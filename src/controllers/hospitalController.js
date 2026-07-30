// src/controllers/hospitalController.js
const db = require('../../config/db');

// 1. Enregistrer un nouvel hôpital
exports.registerHospital = async (req, res) => {
    const { nom, adresse, latitude, longitude, telephone } = req.body;

    // Validation basique des champs obligatoires
    if (!nom || !adresse || !latitude || !longitude) {
        return res.status(400).json({ message: "Le nom, l'adresse et les coordonnées GPS (lat/long) sont obligatoires." });
    }

    try {
        // Insertion dans la table des hôpitaux (schéma medical_logistics)
        const queryText = `
            INSERT INTO medical_logistics.hopitaux (nom, adresse, latitude, longitude, telephone, statut)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const values = [nom, adresse, latitude, longitude, telephone, 'EN_ATTENTE'];
        
        const result = await db.query(queryText, values);
        
        res.status(201).json({
            message: "Demande d'enregistrement de l'hôpital reçue. En attente de validation par l'administration.",
            hopital: result.rows[0]
        });
    } catch (error) {
        console.error("Erreur Enregistrement Hôpital :", error);
        res.status(500).json({ message: "Une erreur est survenue lors de l'enregistrement de l'hôpital." });
    }
};

// 2. Récupérer tous les hôpitaux (ex: pour les afficher sur une carte)
exports.getAllHospitals = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM medical_logistics.hopitaux ORDER BY nom ASC');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur Récupération Hôpitaux :", error);
        res.status(500).json({ message: "Impossible de récupérer la liste des hôpitaux." });
    }
};