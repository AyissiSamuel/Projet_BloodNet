// src/services/droneSimulationService.js
//
// Service de simulation logicielle du drone, conforme au périmètre défini
// dans le cahier des charges (RF-18 à RF-20) : aucun matériel physique requis,
// le déplacement du drone entre l'hôpital vendeur et l'hôpital demandeur est
// simulé côté serveur à partir des coordonnées GPS réelles des deux hôpitaux.
//
// Le calcul de progression est un simple interpolation linéaire dans le temps,
// suffisant pour la version test. Une évolution future pourra s'appuyer sur
// PostGIS pour un calcul d'itinéraire réel (cf. échanges sur la migration PostGIS).

const db = require('../../config/db');

// Durée totale simulée d'une livraison (en millisecondes). 3 minutes ici pour
// permettre une démonstration confortable en soutenance.
const DUREE_SIMULATION_MS = 3 * 60 * 1000;

// Stocke en mémoire les missions actives : { id_commande: { depart, arrivee, heureDebut } }
const missionsActives = new Map();

/**
 * Démarre une mission simulée pour une commande donnée, entre les coordonnées
 * de l'hôpital vendeur (départ) et de l'hôpital demandeur (arrivée).
 */
const demarrerMission = async (id_commande, id_hopital_vendeur, id_hopital_demandeur, drone_id) => {
    const result = await db.query(
        `SELECT id_hopital, latitude, longitude FROM medical_logistics.hopitaux 
         WHERE id_hopital = ANY($1::int[])`,
        [[id_hopital_vendeur, id_hopital_demandeur]]
    );

    const depart = result.rows.find(h => h.id_hopital === id_hopital_vendeur);
    const arrivee = result.rows.find(h => h.id_hopital === id_hopital_demandeur);

    if (!depart || !arrivee) {
        throw new Error("Coordonnées GPS introuvables pour l'hôpital vendeur ou demandeur.");
    }

    missionsActives.set(String(id_commande), {
        drone_id: drone_id || `DRONE-${String(id_commande).padStart(2, '0')}`,
        depart: { lat: parseFloat(depart.latitude), lng: parseFloat(depart.longitude) },
        arrivee: { lat: parseFloat(arrivee.latitude), lng: parseFloat(arrivee.longitude) },
        heureDebut: Date.now(),
        batterieDepart: 95 + Math.random() * 5 // entre 95 et 100%
    });
};

/**
 * Calcule l'état actuel (position, vitesse, altitude, batterie) de la mission
 * simulée associée à une commande, à l'instant présent.
 */
const getTelemetrie = (id_commande) => {
    const mission = missionsActives.get(String(id_commande));

    if (!mission) {
        return null; // Aucune mission active pour cette commande
    }

    const tempsEcoule = Date.now() - mission.heureDebut;
    const progression = Math.min(tempsEcoule / DUREE_SIMULATION_MS, 1); // 0 → 1

    // Interpolation linéaire de la position entre départ et arrivée
    const lat = mission.depart.lat + (mission.arrivee.lat - mission.depart.lat) * progression;
    const lng = mission.depart.lng + (mission.arrivee.lng - mission.depart.lng) * progression;

    // Vitesse simulée : monte en régime puis redescend à l'approche de l'arrivée (profil réaliste)
    const vitesse = progression < 0.1
        ? Math.round(40 * (progression / 0.1))
        : progression > 0.9
            ? Math.round(40 * ((1 - progression) / 0.1))
            : 38 + Math.round(Math.random() * 4);

    // Altitude simulée : palier de croisière à 120m, descente en fin de trajet
    const altitude = progression > 0.92
        ? Math.round(120 * ((1 - progression) / 0.08))
        : 110 + Math.round(Math.random() * 20);

    // Batterie : décroissance linéaire réaliste sur la durée de la mission
    const batterie = Math.max(Math.round(mission.batterieDepart - progression * 35), 55);

    const missionTerminee = progression >= 1;

    return {
        drone_id: mission.drone_id,
        lat: parseFloat(lat.toFixed(6)),
        lng: parseFloat(lng.toFixed(6)),
        speed: vitesse,
        altitude: altitude,
        battery: batterie,
        progression: parseFloat(progression.toFixed(3)),
        statut: missionTerminee ? 'LIVREE' : 'EN_TRANSIT'
    };
};

/**
 * Retire une mission de la mémoire (à appeler une fois la livraison confirmée
 * et le statut de la commande mis à jour en base).
 */
const terminerMission = (id_commande) => {
    missionsActives.delete(String(id_commande));
};

module.exports = {
    demarrerMission,
    getTelemetrie,
    terminerMission
};
