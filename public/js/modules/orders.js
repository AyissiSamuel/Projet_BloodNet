import { showToast } from './toast.js';

let activeTab = 'emises';
let trackingMap = null;
let droneMarker = null;
let telemetryInterval = null;

export const initOrdersModule = async (token) => {
    setupTabEvents(token);
    setupOrderModalEvents(token);
    await fetchOrders(token);
};

// --- 1. GESTION DES ONGLETS (ÉMISES / REÇUES) ---
const setupTabEvents = (token) => {
    const tabs = document.querySelectorAll(".tabs-container .tab-btn");
    tabs.forEach(tab => {
        tab.addEventListener("click", (e) => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            activeTab = tab.getAttribute("data-tab");
            fetchOrders(token);
        });
    });
};

// --- 2. RECUPÉRATION DES COMMANDES ET COMBINAISON TÉLÉMÉTRIE ---
const fetchOrders = async (token) => {
    const tbody = document.getElementById("orders-table-body");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des commandes...</td></tr>`;

    try {
        const response = await fetch(`/api/commandes?type=${activeTab}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error("Erreur de chargement");

        const orders = await response.json();
        renderOrdersTable(orders, token);
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: #e11d48;">Erreur lors de la récupération des commandes.</td></tr>`;
    }
};

// --- 3. RENDU DU TABLEAU ---
const renderOrdersTable = (orders, token) => {
    const tbody = document.getElementById("orders-table-body");
    tbody.innerHTML = "";

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Aucune commande ${activeTab === 'emises' ? 'émise' : 'reçue'}.</td></tr>`;
        return;
    }

    orders.forEach(order => {
        const tr = document.createElement("tr");
        
        // Formate la présence de télémétrie drone si en transit
        const isEnTransit = order.statut_commande === 'EN_TRANSIT';
        const droneStatus = isEnTransit 
            ? `<span class="badge status-emise"><i class="fa-solid fa-plane-departure"></i> En Vol (${order.drone_id || 'DRONE-01'})</span>`
            : `<span class="badge" style="background:#f1f5f9; color:#475569;">Inactif</span>`;

        tr.innerHTML = `
            <td><strong>#${order.id_commande}</strong></td>
            <td>${activeTab === 'emises' ? order.hopital_destinataire : order.hopital_expediteur}</td>
            <td><strong>${order.groupe_sanguin}</strong></td>
            <td>${order.quantite_poches} poche(s)</td>
            <td><span class="badge-status ${getStatusClass(order.statut_commande)}">${order.statut_commande}</span></td>
            <td>${droneStatus}</td>
            <td>
                ${isEnTransit ? `<button class="btn-sm btn-primary btn-track-drone" data-id="${order.id_commande}" data-drone="${order.drone_id || 'DRONE-01'}"><i class="fa-solid fa-location-crosshairs"></i> Suivre Drone</button>` : ''}
                ${activeTab === 'recues' && order.statut_commande === 'EN_ATTENTE' ? `<button class="btn-sm btn-success btn-accept-order" data-id="${order.id_commande}">Accepter & Déployer</button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attacher les clics pour le suivi drone
    document.querySelectorAll(".btn-track-drone").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const orderId = e.currentTarget.getAttribute("data-id");
            const droneId = e.currentTarget.getAttribute("data-drone");
            openDroneTrackingModal(orderId, droneId, token);
        });
    });
};

const getStatusClass = (status) => {
    switch (status) {
        case 'LIVREE': return 'ok';
        case 'EN_TRANSIT': return 'warn';
        case 'EN_ATTENTE': return 'warn';
        case 'ANNULEE': return 'crit';
        default: return 'ok';
    }
};

// --- 4. SUIVI DU DRONE EN TEMPS RÉEL (LEAFLET) ---
const openDroneTrackingModal = (orderId, droneId, token) => {
    document.getElementById("tracking-order-id").textContent = `#${orderId}`;
    document.getElementById("telemetry-drone-id").textContent = droneId;
    const modal = document.getElementById("modal-drone-tracking");
    modal.style.display = "flex";

    // Initialiser Leaflet après l'affichage de la modale (nécessaire pour un bon rendu du canvas)
    setTimeout(() => {
        if (!trackingMap) {
            // Yaoundé par défaut
            trackingMap = L.map('drone-map').setView([3.8480, 11.5021], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap'
            }).addTo(trackingMap);
        } else {
            trackingMap.invalidateSize();
        }

        // Lancer la récupération de la télémétrie en boucle
        startTelemetryPolling(orderId, token);
    }, 200);
};

const startTelemetryPolling = (orderId, token) => {
    clearInterval(telemetryInterval);

    const updateTelemetry = async () => {
        try {
            const res = await fetch(`/api/drones/telemetrie/${orderId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) return;

            const data = await res.json(); 
            // ex: { lat: 3.85, lng: 11.51, speed: 45, altitude: 120, battery: 88 }

            // Mettre à jour l'UI Télémétrie
            document.getElementById("telemetry-speed").textContent = `${data.speed || 0} km/h`;
            document.getElementById("telemetry-altitude").textContent = `${data.altitude || 0} m`;
            document.getElementById("telemetry-battery").textContent = `${data.battery || 0}%`;

            const pos = [data.lat || 3.8480, data.lng || 11.5021];

            // Mettre à jour la carte Leaflet
            if (!droneMarker) {
                droneMarker = L.marker(pos).addTo(trackingMap).bindPopup(`<b>Drone ${data.drone_id}</b><br>En livraison`).openPopup();
            } else {
                droneMarker.setLatLng(pos);
            }
            trackingMap.panTo(pos);

        } catch (err) {
            console.error("Erreur télémétrie:", err);
        }
    };

    updateTelemetry();
    telemetryInterval = setInterval(updateTelemetry, 3000); // Mise à jour toutes les 3 sec
};

// --- 5. ÉVÉNEMENTS DES MODALES ---
const setupOrderModalEvents = (token) => {
    const modalOrder = document.getElementById("modal-create-order");
    const modalTracking = document.getElementById("modal-drone-tracking");

    document.getElementById("btn-open-order-modal")?.addEventListener("click", () => modalOrder.style.display = "flex");
    document.getElementById("close-order-modal")?.addEventListener("click", () => modalOrder.style.display = "none");
    document.getElementById("cancel-order-modal")?.addEventListener("click", () => modalOrder.style.display = "none");

    document.getElementById("close-tracking-modal")?.addEventListener("click", () => {
        modalTracking.style.display = "none";
        clearInterval(telemetryInterval);
    });

    // Formulaire de création de demande
    document.getElementById("form-create-order")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            hopital_destinataire: document.getElementById("order-hospital").value,
            groupe_sanguin: document.getElementById("order-blood-group").value,
            quantite: parseInt(document.getElementById("order-quantity").value, 10),
            urgence: document.getElementById("order-urgency").value
        };

        const res = await fetch('/api/commandes/creer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast("Demande transmise avec succès", "success");
            modalOrder.style.display = "none";
            fetchOrders(token);
        } else {
            showToast("Erreur lors de l'émission de la commande", "error");
        }
    });
};