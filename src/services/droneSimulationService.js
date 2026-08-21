// src/services/droneSimulationService.js
const db = require('../../config/db');

// --- CONFIGURATION DE LA SIMULATION ---
const ACCELERATION_TEMPS = 5; // 1 seconde réelle = 5 secondes de vol simulé
const VITESSE_CROISIERE_KMH = 70; // Vitesse moyenne d'un drone médical (70 km/h)

// --- GESTION DE LA FLOTTE (In-Memory Fleet) ---
// On initialise quelques drones par défaut. On pourra en ajouter/retirer dynamiquement.
const flotteDrones = new Map([
    ["DRONE-01", { id: "DRONE-01", nom: "SkyMedic Alpha", batterie: 100, statut: "DISPONIBLE" }],
    ["DRONE-02", { id: "DRONE-02", nom: "SkyMedic Beta", batterie: 100, statut: "DISPONIBLE" }],
    ["DRONE-03", { id: "DRONE-03", nom: "SkyMedic Gamma", batterie: 85, statut: "DISPONIBLE" }]
]);

// Missions actives : { id_commande: { drone_id, depart, arrivee, controlPoint, heureDebut, dureeVolMs } }
const missionsActives = new Map();

// --- OUTILS GEOGRAPHIQUES & MATHÉMATIQUES ---

// 1. Calcul de distance orthodromique (Haversine) en km
function calculerDistanceHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 2. Génération d'un point de contrôle perpendiculaire pour la courbe de Bézier
function genererPointDeControle(depart, arrivee) {
    const midLat = (depart.lat + arrivee.lat) / 2;
    const midLng = (depart.lng + arrivee.lng) / 2;
    
    // Décalage perpendiculaire arbitraire (~1 à 2 km à l'échelle géographique)
    const offsetFactor = 0.015; 
    const controlLat = midLat + (arrivee.lng - depart.lng) * offsetFactor;
    const controlLng = midLng - (arrivee.lat - depart.lat) * offsetFactor;

    return { lat: controlLat, lng: controlLng };
}

// 3. Interpolation Bézier Quadratique : B(t) = (1-t)²*P0 + 2(1-t)t*P1 + t²*P2
function interpolerBezier(P0, P1, P2, t) {
    const lat = Math.pow(1 - t, 2) * P0.lat + 2 * (1 - t) * t * P1.lat + Math.pow(t, 2) * P2.lat;
    const lng = Math.pow(1 - t, 2) * P0.lng + 2 * (1 - t) * t * P1.lng + Math.pow(t, 2) * P2.lng;
    return { lat, lng };
}


// --- FONCTIONS EXPORTÉES ---

/**
 * Gestion de la flotte : Obtenir, ajouter ou retirer des drones
 */
const getFlotte = () => Array.from(flotteDrones.values());

const ajouterDrone = (id, nom) => {
    if (flotteDrones.has(id)) throw new Error("Ce drone existe déjà.");
    const nouveauDrone = { id, nom: nom || `Drone ${id}`, batterie: 100, statut: "DISPONIBLE" };
    flotteDrones.set(id, nouveauDrone);
    return nouveauDrone;
};

const retirerDrone = (id) => {
    const drone = flotteDrones.get(id);
    if (!drone) throw new Error("Drone introuvable.");
    if (drone.statut === "EN_VOL") throw new Error("Impossible de retirer un drone en mission.");
    flotteDrones.delete(id);
    return true;
};

/**
 * Démarre une nouvelle mission de livraison
 */
const demarrerMission = async (id_commande, id_hopital_vendeur, id_hopital_demandeur) => {
    // 1. Trouver un drone disponible dans la flotte
    const droneDispo = Array.from(flotteDrones.values()).find(d => d.statut === "DISPONIBLE" && d.batterie > 30);
    if (!droneDispo) {
        throw new Error("Aucun drone disponible ou suffisamment chargé pour cette mission.");
    }

    // 2. Récupérer les coordonnées GPS des hôpitaux
    const result = await db.query(
        `SELECT id_hopital, latitude, longitude FROM medical_logistics.hopitaux 
         WHERE id_hopital = ANY($1::uuid[])`,
        [[id_hopital_vendeur, id_hopital_demandeur]]
    );

    const depart = result.rows.find(h => h.id_hopital === id_hopital_vendeur);
    const arrivee = result.rows.find(h => h.id_hopital === id_hopital_demandeur);

    if (!depart || !arrivee) {
        throw new Error("Coordonnées GPS introuvables pour les hôpitaux concernés.");
    }

    const posDepart = { lat: parseFloat(depart.latitude), lng: parseFloat(depart.longitude) };
    const posArrivee = { lat: parseFloat(arrivee.latitude), lng: parseFloat(arrivee.longitude) };

    // 3. Calcul de la distance et de la durée réelle compensée par l'accélération
    const distanceKm = calculerDistanceHaversine(posDepart.lat, posDepart.lng, posArrivee.lat, posArrivee.lng);
    const dureeReelleHeures = distanceKm / VITESSE_CROISIERE_KMH;
    const dureeVolMs = (dureeReelleHeures * 3600 * 1000) / ACCELERATION_TEMPS;

    // 4. Marquer le drone comme occupé
    droneDispo.statut = "EN_VOL";

    // 5. Enregistrer la mission
    const controlPoint = genererPointDeControle(posDepart, posArrivee);
    
    missionsActives.set(String(id_commande), {
        drone_id: droneDispo.id,
        depart: posDepart,
        arrivee: posArrivee,
        controlPoint: controlPoint,
        heureDebut: Date.now(),
        dureeVolMs: Math.max(dureeVolMs, 15000), // Au moins 15 sec pour les très courtes distances
        batterieDepart: droneDispo.batterie,
        distanceKm: distanceKm
    });

    return droneDispo.id;
};

/**
 * Récupère la télémétrie courante ET persiste l'état dans la table `drone_telemetry.commandes`
 */
const getTelemetrieEtPersister = async (id_commande) => {
    const mission = missionsActives.get(String(id_commande));
    if (!mission) return null;

    const tempsEcoule = Date.now() - mission.heureDebut;
    const t = Math.min(tempsEcoule / mission.dureeVolMs, 1); // Progression de 0 à 1

    // Position courbe (Bézier)
    const position = interpolerBezier(mission.depart, mission.controlPoint, mission.arrivee, t);

    // Profils réalistes
    const altitude = t < 0.05 ? Math.round(120 * (t / 0.05)) : (t > 0.95 ? Math.round(120 * ((1 - t) / 0.05)) : 120);
    const vitesse = t < 0.05 ? Math.round(VITESSE_CROISIERE_KMH * (t / 0.05)) : (t > 0.95 ? Math.round(VITESSE_CROISIERE_KMH * ((1 - t) / 0.05)) : VITESSE_CROISIERE_KMH);
    const consommationEstimee = Math.round((mission.distanceKm * 2.5) * t); // ~2.5% de batterie par km
    const batterieCourante = Math.max(mission.batterieDepart - consommationEstimee, 5);

    const missionTerminee = t >= 1;
    const statutVol = missionTerminee ? 'LIVREE' : 'EN_VOL';

    // Mettre à jour la flotte en mémoire
    const drone = flotteDrones.get(mission.drone_id);
    if (drone) {
        drone.batterie = batterieCourante;
        if (missionTerminee) {
            drone.statut = "EN_CHARGE"; // Se rechargera progressivement
        }
    }

    // --- PERSISTANCE EN BDD (drone_telemetry.commandes) ---
    try {
        await db.query(
            `UPDATE drone_telemetry.commandes 
             SET drone_latitude = $1, 
                 drone_longitude = $2, 
                 drone_batterie = $3, 
                 statut_commande = $4,
                 date_livraison = CASE WHEN $4 = 'LIVREE' THEN NOW() ELSE date_livraison END
             WHERE id_commande_metier = $5`,
            [position.lat, position.lng, batterieCourante, statutVol, id_commande]
        );
    } catch (err) {
        console.error("Erreur de persistance BDD de la télémétrie :", err.message);
    }

    // Nettoyage de la mission mémoire si achevée
    if (missionTerminee) {
        missionsActives.delete(String(id_commande));
    }

    return {
        drone_id: mission.drone_id,
        lat: parseFloat(position.lat.toFixed(6)),
        lng: parseFloat(position.lng.toFixed(6)),
        speed: vitesse,
        altitude: altitude,
        battery: batterieCourante,
        progression: parseFloat(t.toFixed(3)),
        statut: statutVol
    };
};

module.exports = {
    getFlotte,
    ajouterDrone,
    retirerDrone,
    demarrerMission,
    getTelemetrieEtPersister
};