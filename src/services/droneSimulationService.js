// src/services/droneSimulationService.js
//
// ÉVOLUTION (audit) : le vol simulé se limitait auparavant à un seul
// tronçon Hôpital vendeur → Hôpital demandeur. Le drone n'avait ni point de
// départ propre, ni retour "à la maison" après livraison. Ce fichier
// découpe maintenant chaque mission en 3 tronçons successifs, avec la même
// mécanique d'interpolation Bézier que l'existant (juste réappliquée trois
// fois) :
//   1. BASE            → Hôpital vendeur   (le drone va chercher les poches)
//   2. Hôpital vendeur  → Hôpital demandeur (livraison — statut métier passe à LIVREE ici)
//   3. Hôpital demandeur → BASE            (retour à vide)
const db = require('../../config/db');

// --- CONFIGURATION DE LA SIMULATION ---
const ACCELERATION_TEMPS = 5; // 1 seconde réelle = 5 secondes de vol simulé
const VITESSE_CROISIERE_KMH = 70; // Vitesse moyenne d'un drone médical (70 km/h)

// Base logistique BloodNet — point de départ/retour de tous les drones.
// Coordonnées configurables via variables d'environnement pour un déploiement
// réel ; valeur par défaut sur Yaoundé (cohérente avec le reste du projet).
const BASE_DRONE = {
    nom: process.env.DRONE_BASE_NOM || "Base Logistique BloodNet",
    lat: parseFloat(process.env.DRONE_BASE_LAT) || 3.8600,
    lng: parseFloat(process.env.DRONE_BASE_LNG) || 11.5300
};

// --- GESTION DE LA FLOTTE (In-Memory Fleet) ---
const flotteDrones = new Map([
    ["DRONE-01", { id: "DRONE-01", nom: "SkyMedic Alpha", batterie: 100, statut: "DISPONIBLE" }],
    ["DRONE-02", { id: "DRONE-02", nom: "SkyMedic Beta", batterie: 100, statut: "DISPONIBLE" }],
    ["DRONE-03", { id: "DRONE-03", nom: "SkyMedic Gamma", batterie: 85, statut: "DISPONIBLE" }]
]);

// Missions actives : { id_commande: { drone_id, phases: [...], phaseIndex, heureDebutPhase, batterieAvantPhase, noms, ... } }
const missionsActives = new Map();

// --- OUTILS GEOGRAPHIQUES & MATHÉMATIQUES ---

function calculerDistanceHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function genererPointDeControle(depart, arrivee) {
    const midLat = (depart.lat + arrivee.lat) / 2;
    const midLng = (depart.lng + arrivee.lng) / 2;
    const offsetFactor = 0.015;
    const controlLat = midLat + (arrivee.lng - depart.lng) * offsetFactor;
    const controlLng = midLng - (arrivee.lat - depart.lat) * offsetFactor;
    return { lat: controlLat, lng: controlLng };
}

function interpolerBezier(P0, P1, P2, t) {
    const lat = Math.pow(1 - t, 2) * P0.lat + 2 * (1 - t) * t * P1.lat + Math.pow(t, 2) * P2.lat;
    const lng = Math.pow(1 - t, 2) * P0.lng + 2 * (1 - t) * t * P1.lng + Math.pow(t, 2) * P2.lng;
    return { lat, lng };
}

// Construit un tronçon de vol complet (distance, durée, point de contrôle)
function construireTroncon(nom, depart, arrivee) {
    const distanceKm = calculerDistanceHaversine(depart.lat, depart.lng, arrivee.lat, arrivee.lng);
    const dureeReelleHeures = distanceKm / VITESSE_CROISIERE_KMH;
    const dureeVolMs = Math.max((dureeReelleHeures * 3600 * 1000) / ACCELERATION_TEMPS, 8000); // min 8 sec/tronçon
    return {
        nom, // 'ALLER_CHERCHER' | 'LIVRAISON' | 'RETOUR_BASE'
        depart,
        arrivee,
        controlPoint: genererPointDeControle(depart, arrivee),
        distanceKm,
        dureeVolMs
    };
}

// --- FONCTIONS EXPORTÉES ---

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
 * Démarre une nouvelle mission de livraison en 3 tronçons :
 * Base → Vendeur → Demandeur → Base.
 */
const demarrerMission = async (id_commande, id_hopital_vendeur, id_hopital_demandeur) => {
    const droneDispo = Array.from(flotteDrones.values()).find(d => d.statut === "DISPONIBLE" && d.batterie > 30);
    if (!droneDispo) {
        throw new Error("Aucun drone disponible ou suffisamment chargé pour cette mission.");
    }

    const result = await db.query(
        `SELECT id_hopital, nom, latitude, longitude FROM medical_logistics.hopitaux 
         WHERE id_hopital = ANY($1::uuid[])`,
        [[id_hopital_vendeur, id_hopital_demandeur]]
    );

    const vendeur = result.rows.find(h => h.id_hopital === id_hopital_vendeur);
    const demandeur = result.rows.find(h => h.id_hopital === id_hopital_demandeur);

    if (!vendeur || !demandeur) {
        throw new Error("Coordonnées GPS introuvables pour les hôpitaux concernés.");
    }

    const posVendeur = { lat: parseFloat(vendeur.latitude), lng: parseFloat(vendeur.longitude) };
    const posDemandeur = { lat: parseFloat(demandeur.latitude), lng: parseFloat(demandeur.longitude) };
    const posBase = { lat: BASE_DRONE.lat, lng: BASE_DRONE.lng };

    const phases = [
        construireTroncon('ALLER_CHERCHER', posBase, posVendeur),
        construireTroncon('LIVRAISON', posVendeur, posDemandeur),
        construireTroncon('RETOUR_BASE', posDemandeur, posBase)
    ];

    droneDispo.statut = "EN_VOL";

    missionsActives.set(String(id_commande), {
        drone_id: droneDispo.id,
        phases,
        phaseIndex: 0,
        heureDebutPhase: Date.now(),
        batterieAvantPhase: droneDispo.batterie,
        nomVendeur: vendeur.nom,
        nomDemandeur: demandeur.nom,
        base: { nom: BASE_DRONE.nom, ...posBase },
        pointVendeur: posVendeur,
        pointDemandeur: posDemandeur
    });

    return droneDispo.id;
};

const LIBELLES_PHASE = {
    ALLER_CHERCHER: "En route vers l'hôpital fournisseur",
    LIVRAISON: "Livraison vers l'hôpital demandeur",
    RETOUR_BASE: "Retour à la base",
    AU_SOL: "Mission terminée — drone à la base"
};

/**
 * Récupère la télémétrie courante, fait avancer la mission d'un tronçon à
 * l'autre si nécessaire, ET persiste l'état dans `drone_telemetry.commandes`.
 */
const getTelemetrieEtPersister = async (id_commande) => {
    const mission = missionsActives.get(String(id_commande));
    if (!mission) return null;

    let phase = mission.phases[mission.phaseIndex];
    let tempsEcoule = Date.now() - mission.heureDebutPhase;
    let t = Math.min(tempsEcoule / phase.dureeVolMs, 1);

    const position = interpolerBezier(phase.depart, phase.controlPoint, phase.arrivee, t);

    const consommationTroncon = Math.round((phase.distanceKm * 2.5) * t);
    const batterieCourante = Math.max(mission.batterieAvantPhase - consommationTroncon, 5);

    const altitude = t < 0.05 ? Math.round(120 * (t / 0.05)) : (t > 0.95 ? Math.round(120 * ((1 - t) / 0.05)) : 120);
    const vitesse = t < 0.05 ? Math.round(VITESSE_CROISIERE_KMH * (t / 0.05)) : (t > 0.95 ? Math.round(VITESSE_CROISIERE_KMH * ((1 - t) / 0.05)) : VITESSE_CROISIERE_KMH);

    let phaseTerminee = t >= 1;
    let missionCompletementTerminee = false;

    if (phaseTerminee) {
        if (mission.phaseIndex < mission.phases.length - 1) {
            // Passage au tronçon suivant
            mission.batterieAvantPhase = batterieCourante;
            mission.phaseIndex += 1;
            mission.heureDebutPhase = Date.now();
            phase = mission.phases[mission.phaseIndex];
        } else {
            // Dernier tronçon (retour base) terminé : mission close
            missionCompletementTerminee = true;
        }
    }

    // Statut métier de la commande : livrée dès la fin du tronçon LIVRAISON,
    // qu'importe si le drone est encore en train de rentrer à la base.
    const livraisonEffectuee = mission.phaseIndex >= 2; // on est entré dans RETOUR_BASE ou au-delà
    const statutMetier = livraisonEffectuee ? 'LIVREE' : 'EN_VOL';
    const phaseActuelle = missionCompletementTerminee ? 'AU_SOL' : phase.nom;

    // Mise à jour de la flotte en mémoire
    const drone = flotteDrones.get(mission.drone_id);
    if (drone) {
        drone.batterie = batterieCourante;
        if (missionCompletementTerminee) {
            drone.statut = "EN_CHARGE"; // se rechargera progressivement
        }
    }

    // --- PERSISTANCE EN BDD ---
    try {
        await db.query(
            `UPDATE drone_telemetry.commandes 
             SET drone_latitude = $1, 
                 drone_longitude = $2, 
                 drone_batterie = $3, 
                 statut_commande = $4,
                 date_livraison = CASE WHEN $4 = 'LIVREE' AND date_livraison IS NULL THEN NOW() ELSE date_livraison END
             WHERE id_commande_metier = $5`,
            [position.lat, position.lng, batterieCourante, statutMetier, id_commande]
        );
    } catch (err) {
        console.error("Erreur de persistance BDD de la télémétrie :", err.message);
    }

    const reponse = {
        drone_id: mission.drone_id,
        lat: parseFloat(position.lat.toFixed(6)),
        lng: parseFloat(position.lng.toFixed(6)),
        speed: vitesse,
        altitude: altitude,
        battery: batterieCourante,
        progression: parseFloat(t.toFixed(3)),
        statut: statutMetier,          // statut métier de la commande : EN_VOL | LIVREE
        phase: phaseActuelle,          // étape du vol du drone
        phase_libelle: LIBELLES_PHASE[phaseActuelle],
        // Points fixes pour l'affichage des marqueurs côté carte (base +
        // hôpital vendeur + hôpital demandeur) — évite un appel API en plus
        // pour le frontend.
        base: mission.base,
        point_vendeur: { ...mission.pointVendeur, nom: mission.nomVendeur },
        point_demandeur: { ...mission.pointDemandeur, nom: mission.nomDemandeur }
    };

    if (missionCompletementTerminee) {
        missionsActives.delete(String(id_commande));
    }

    return reponse;
};

module.exports = {
    getFlotte,
    ajouterDrone,
    retirerDrone,
    demarrerMission,
    getTelemetrieEtPersister,
    BASE_DRONE
};
