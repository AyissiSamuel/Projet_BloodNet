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

// --- FONCTION DE CHARGEMENT DYNAMIQUE DES HÔPITAUX ---
// order.js
const fetchHopitauxVendeurs = async (token) => {
    const selectElem = document.getElementById("select-hopital-vendeur");
    if (!selectElem) return;

    try {
        // 1. Correction du path : /api/hospitals/all au lieu de /api/hopitaux/all
        const res = await fetch('/api/hospitals/all', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur lors de la récupération des hôpitaux");

        const hopitaux = await res.json();
        
        selectElem.innerHTML = '<option value="">-- Sélectionnez un hôpital --</option>';

        hopitaux.forEach(h => {
            const option = document.createElement('option');
            // 2. Vérification des colonnes SQL (nom au lieu de nom_hopital selon ta table DB)
            option.value = h.id_hopital; 
            option.textContent = h.nom; 
            selectElem.appendChild(option);
        });
    } catch (err) {
        console.error("Erreur hôpitaux:", err);
        showToast("Impossible de charger la liste des hôpitaux", "error");
    }
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

// --- 2. RECUPÉRATION DES COMMANDES ---
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
        const isEnTransit = order.statut_commande === 'EXPEDIEE';
        const droneStatus = isEnTransit 
            ? `<span class="badge status-emise"><i class="fa-solid fa-plane-departure"></i> En Vol</span>`
            : `<span class="badge" style="background:#f1f5f9; color:#475569;">Inactif</span>`;

        tr.innerHTML = `
            <td><strong>#${order.id_commande}</strong></td>
            <td>${activeTab === 'emises' ? order.hopital_destinataire : order.hopital_expediteur}</td>
            <td><strong>${order.groupe_sanguin}</strong></td>
            <td>${order.quantite_poches} poche(s)</td>
            <td><span class="badge-status ${getStatusClass(order.statut_commande)}">${order.statut_commande}</span></td>
            <td>${droneStatus}</td>
            <td>
                ${isEnTransit ? `<button class="btn-sm btn-primary btn-track-drone" data-id="${order.id_commande}"><i class="fa-solid fa-location-crosshairs"></i> Suivre Drone</button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-track-drone").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const orderId = e.currentTarget.getAttribute("data-id");
            openDroneTrackingModal(orderId, token);
        });
    });
};

const getStatusClass = (status) => {
    switch (status) {
        case 'LIVREE': return 'ok';
        case 'ACCEPTEE': return 'ok';
        case 'EXPEDIEE': return 'warn';
        case 'EN_ATTENTE': return 'warn';
        case 'REFUSEE': return 'crit';
        case 'ANNULEE': return 'crit';
        default: return 'warn';
    }
};

// --- 4. SUIVI DU DRONE EN TEMPS RÉEL (LEAFLET) ---
const openDroneTrackingModal = (orderId, token) => {
    document.getElementById("tracking-order-id").textContent = `#${orderId}`;
    document.getElementById("telemetry-drone-id").textContent = "Connexion...";
    const modal = document.getElementById("modal-drone-tracking");
    modal.style.display = "flex";

    setTimeout(() => {
        if (!trackingMap) {
            trackingMap = L.map('drone-map').setView([3.8480, 11.5021], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap'
            }).addTo(trackingMap);
        } else {
            trackingMap.invalidateSize();
        }

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

            document.getElementById("telemetry-drone-id").textContent = data.drone_id || `#${orderId}`;
            document.getElementById("telemetry-battery").textContent = `${data.battery || 0}%`;

            const pos = [data.lat || 3.8480, data.lng || 11.5021];

            if (!droneMarker) {
                droneMarker = L.marker(pos).addTo(trackingMap).bindPopup(`<b>Drone ${data.drone_id || ''}</b><br>En livraison`).openPopup();
            } else {
                droneMarker.setLatLng(pos);
            }
            trackingMap.panTo(pos);

            if (data.statut === 'LIVREE') {
                clearInterval(telemetryInterval);
            }

        } catch (err) {
            console.error("Erreur télémétrie:", err);
        }
    };

    updateTelemetry();
    telemetryInterval = setInterval(updateTelemetry, 3000);
};

// --- 5. ÉVÉNEMENTS DES MODALES ---
const setupOrderModalEvents = (token) => {
    const modalOrder = document.getElementById("modal-create-order");
    const modalTracking = document.getElementById("modal-drone-tracking");

    document.getElementById("btn-open-order-modal")?.addEventListener("click", () => {
        modalOrder.style.display = "flex";
        fetchHopitauxVendeurs(token); // <--- Charge la liste à chaque ouverture de modale
    });

    document.getElementById("close-order-modal")?.addEventListener("click", () => modalOrder.style.display = "none");
    document.getElementById("cancel-order-modal")?.addEventListener("click", () => modalOrder.style.display = "none");

    document.getElementById("close-tracking-modal")?.addEventListener("click", () => {
        modalTracking.style.display = "none";
        clearInterval(telemetryInterval);
    });

    // Formulaire de création de demande

document.getElementById("form-create-order")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const selectedHospitalId = document.getElementById("select-hopital-vendeur").value;
    const bloodGroupValue = document.getElementById("order-blood-group").value; // ex: "A+"
    const quantityValue = parseInt(document.getElementById("order-quantity").value, 10);

    if (!selectedHospitalId) {
        showToast("Veuillez sélectionner un hôpital destinataire", "error");
        return;
    }

    // Extraction automatique du rhésus si présent à la fin de la chaîne (ex: "O+" -> groupe: "O", rhesus: "+")
    let groupe = bloodGroupValue;
    let rhesus = document.getElementById("order-rhesus")?.value || "";

    if (!rhesus && /[+-]$/.test(bloodGroupValue)) {
        rhesus = bloodGroupValue.slice(-1);
        groupe = bloodGroupValue.slice(0, -1);
    }

    // Payload conforme à ce qu'attend commandeController.js
    const payload = {
        id_hopital_vendeur: selectedHospitalId,
        groupe_sanguin: groupe,
        rhesus: rhesus,
        quantite: quantityValue // FIXED: "quantite" au lieu de "quantite_poches"
    };

    try {
        const res = await fetch('/api/commandes/creer', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
            showToast("Demande transmise avec succès", "success");
            modalOrder.style.display = "none";
            document.getElementById("form-create-order").reset();
            fetchOrders(token);
        } else {
            // Affiche le message d'erreur exact renvoyé par le backend
            showToast(data.message || "Erreur lors de l'émission de la commande", "error");
        }
    } catch (err) {
        showToast("Erreur réseau lors de la création de la commande", "error");
    }
});
};