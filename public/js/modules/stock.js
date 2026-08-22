//stock.js
import { showToast } from './toast.js';

let chartInstance = null;
let dashboardMapInstance = null;

export const initStockModule = async (token, isDashboardHome = false) => {
    // Initialisation conditionnelle de la carte 
    const mapElement = document.getElementById('map');
    if (mapElement) {
        if (mapElement._leaflet_id) {
            mapElement._leaflet_id = null;
        }
        dashboardMapInstance = L.map('map').setView([3.8480, 11.5021], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(dashboardMapInstance);

        // CORRECTIF : la carte n'affichait jusqu'ici aucun marqueur — le
        // tileLayer était posé mais aucune donnée d'hôpital n'était jamais
        // chargée ni affichée. On réutilise l'endpoint /api/hospitals/overview
        // (déjà existant côté backend mais jamais appelé) pour poser un
        // marqueur par hôpital affilié, avec un clic pour voir son stock.
        await loadHospitalsOnMap(dashboardMapInstance, token);
    }

    // Attachement des écouteurs d'événements pour les modales et formulaires
    setupStockEvents(token);

    await fetchStockData(token);
    
    if (isDashboardHome) {
        await fetchDashboardKPIs(token);
        await fetchAffiliatedHospitalsStock(token);
    } else {
        setupStockEvents(token);
        setupFilterEvents(token);
        await fetchStockData(token);
        await fetchUsedPockets(token);
    }
};

// --- CARTE : HÔPITAUX AFFILIÉS, VISIBILITÉ TEMPS RÉEL + CLIC POUR LE STOCK ---
const loadHospitalsOnMap = async (map, token) => {
    try {
        const response = await fetch('/api/hospitals/overview', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error("Erreur de récupération des hôpitaux");

        const hopitaux = await response.json();
        const bounds = [];

        hopitaux.forEach(h => {
            const lat = parseFloat(h.latitude);
            const lng = parseFloat(h.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            const icone = L.divIcon({
                className: '',
                html: `<div style="background:#DC2626; width:14px; height:14px; border-radius:50%; border:2px solid white; box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>`,
                iconSize: [14, 14]
            });

            const marker = L.marker([lat, lng], { icon: icone }).addTo(map);

            // Le clic affiche le détail du stock par groupe sanguin (stock_details
            // est un objet JSON { "O+": 12, "A-": 3, ... } renvoyé par le backend).
            const stockLines = Object.entries(h.stock_details || {})
                .map(([groupe, qte]) => `<span style="display:inline-block; width:48%; font-size:0.8rem;"><strong>${groupe}</strong> : ${qte}</span>`)
                .join('');

            marker.bindPopup(`
                <strong>${h.nom}</strong><br>
                <span style="color:#64748b; font-size:0.8rem;">${h.region || 'Région non renseignée'}</span><br>
                <hr style="margin:6px 0;">
                <strong>Stock total : ${h.total_poches} poche(s)</strong><br>
                <div style="margin-top:4px;">${stockLines || '<em>Aucun stock disponible</em>'}</div>
                <small style="color:#94a3b8;">${h.telephone || ''}</small>
            `);

            bounds.push([lat, lng]);
        });

        if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [30, 30] });
        }
    } catch (err) {
        console.error("Erreur chargement carte des hôpitaux :", err);
        showToast("Impossible de charger la carte des hôpitaux affiliés", "error");
    }
};

// --- MISE À JOUR DES KPI DANS LE DASHBOARD ---
export const fetchDashboardKPIs = async (token) => {
    try {
        const response = await fetch('/api/dashboard/kpis', {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error("Erreur de récupération des KPIs");

        const data = await response.json();

        // Injecte les valeurs réelles dans le HTML
        const totalElem = document.getElementById("kpi-total-stock");
        const criticalElem = document.getElementById("kpi-critical-stock");
        const pendingElem = document.getElementById("kpi-pending-orders");
        const donorsElem = document.getElementById("kpi-active-donors");

        if (totalElem) totalElem.textContent = data.total_stock ?? '0';
        if (criticalElem) criticalElem.textContent = data.critical_stock ?? '0';
        if (pendingElem) pendingElem.textContent = data.pending_orders ?? '0';
        if (donorsElem) donorsElem.textContent = data.active_donors ?? '0';

    } catch (error) {
        console.error("Impossible de charger les KPI :", error);
        // Fallback visuel en cas d'erreur
        ["kpi-total-stock", "kpi-critical-stock", "kpi-pending-orders", "kpi-active-donors"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = "N/A";
        });
    }
};
// --- 1. CHARGEMENT DU STOCK ---
const fetchStockData = async (token) => {
    try {
        const response = await fetch('/api/poches/agrege', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error("Erreur de récupération du stock");

        const stockData = await response.json();
        renderStockTableAndCards(stockData);
        
        if (document.getElementById("stockChart")) {
            renderStockChart(stockData);
        }
    } catch (err) {
        console.error(err);
        showToast("Impossible de charger les données du stock", "error");
    }
};

// --- 2. RENDU DU TABLEAU ET CARTE DES STOCKS ---
const renderStockTableAndCards = (data) => {
    const tbody = document.getElementById("stock-table-body");
    const cardsContainer = document.getElementById("stock-stat-cards");

    if (!tbody || !cardsContainer) return;

    tbody.innerHTML = "";
    cardsContainer.innerHTML = "";

    // 1. Mise à jour du tableau HTML
    data.forEach(item => {
        // Adaptation aux noms de colonnes SQL : groupe_sanguin, composant, quantite_disponible
        const group = item.groupe_sanguin || "N/A";
        const component = item.composant || "Non spécifié";
        const count = parseInt(item.quantite_disponible, 10) || 0;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong class="badge-blood">${group}</strong></td>
            <td>${component}</td>
            <td>${count} poche(s)</td>
            <td>
                <span class="status-badge ${count > 5 ? 'status-ok' : 'status-low'}">
                    ${count > 5 ? 'En Stock' : 'Critique'}
                </span>
            </td>
        `;
        tbody.appendChild(row);
    });

    // 2. Aggrégation par groupe sanguin pour l'affichage sous forme de Cartes
    const aggregatedByGroup = data.reduce((acc, curr) => {
        const group = curr.groupe_sanguin;
        const count = parseInt(curr.quantite_disponible, 10) || 0;
        
        acc[group] = (acc[group] || 0) + count;
        return acc;
    }, {});

    // 3. Génération des Cartes pour chaque groupe (A+, O-, etc.)
    Object.entries(aggregatedByGroup).forEach(([group, totalPoches]) => {
        const card = document.createElement("div");
        card.className = "card-stock";
        card.innerHTML = `
            <h3>${group}</h3>
            <p class="count">${totalPoches} poche(s)</p>
            <small>Total disponible</small>
        `;
        cardsContainer.appendChild(card);
    });
};

// --- 3. GRAPHIQUE CHART.JS ---
const renderStockChart = (data) => {
    const ctx = document.getElementById("stockChart");
    if (!ctx) return;

    // Extraction des groupes et des quantités depuis le payload d'origine
    const labels = data.map(item => `${item.groupe_sanguin} (${item.composant})`);
    const quantities = data.map(item => parseInt(item.quantite_disponible, 10) || 0);

    // Destruction de l'ancien graphique s'il existe déjà
    if (window.myStockChart) {
        window.myStockChart.destroy();
    }

    window.myStockChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Poches disponibles',
                data: quantities,
                backgroundColor: 'rgba(220, 53, 69, 0.7)',
                borderColor: 'rgba(220, 53, 69, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
};
// --- 4. STOCK DES HÔPITAUX AFFILIÉS PAR GROUPE SANGUIN ---

const GROUPES_SANGUINS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

const fetchAffiliatedHospitalsStock = async (token) => {
    const thead = document.getElementById("affiliated-stock-thead");
    const tbody = document.getElementById("recent-orders-tbody");
    if (!tbody) return;

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th>Hôpital</th>
                ${GROUPES_SANGUINS.map(g => `<th style="text-align:center;">${g}</th>`).join('')}
                <th>Total</th>
            </tr>
        `;
    }

    try {
        const response = await fetch('/api/hospitals/overview', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Erreur de récupération des hôpitaux affiliés");

        const hopitaux = await response.json();

        tbody.innerHTML = "";
        if (hopitaux.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${GROUPES_SANGUINS.length + 2}" class="text-center">Aucun établissement affilié pour le moment.</td></tr>`;
            return;
        }

        hopitaux.forEach(h => {
            const details = h.stock_details || {};
            const cells = GROUPES_SANGUINS.map(g => {
                const qte = details[g] || 0;
                const couleur = qte === 0 ? '#dc2626' : qte <= 3 ? '#d97706' : '#16a34a';
                return `<td style="text-align:center; color:${couleur}; font-weight:600;">${qte}</td>`;
            }).join('');

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${h.nom}</strong><br><small style="color:#64748b;">${h.region || ''}</small></td>
                ${cells}
                <td><strong>${h.total_poches}</strong></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Erreur chargement stock des hôpitaux affiliés :", err);
        tbody.innerHTML = `<tr><td colspan="${GROUPES_SANGUINS.length + 2}" class="text-center">Impossible de charger le stock des hôpitaux affiliés.</td></tr>`;
    }
};

// --- 5. GESTION DES MODALES ET ÉVÉNEMENTS ---
const openUseModal = (group) => {
    const inputGroup = document.getElementById("use-blood-group");
    const displayGroup = document.getElementById("use-group-display");
    
    if (inputGroup) inputGroup.value = group;
    if (displayGroup) displayGroup.textContent = group;
    
    const modalUse = document.getElementById("modal-use-stock");
    if (modalUse) modalUse.style.display = "flex";
};

const setupStockEvents = (token) => {
    // Modale d'ajout
    const modalAdd = document.getElementById("modal-add-stock");
    document.getElementById("btn-open-add-modal")?.addEventListener("click", () => {
        if (modalAdd) modalAdd.style.display = "flex";
    });
    document.getElementById("close-add-modal")?.addEventListener("click", () => {
        if (modalAdd) modalAdd.style.display = "none";
    });
    document.getElementById("cancel-add-modal")?.addEventListener("click", () => {
        if (modalAdd) modalAdd.style.display = "none";
    });

    // Modale de sortie
    const modalUse = document.getElementById("modal-use-stock");
    document.getElementById("close-use-modal")?.addEventListener("click", () => {
        if (modalUse) modalUse.style.display = "none";
    });
    document.getElementById("cancel-use-modal")?.addEventListener("click", () => {
        if (modalUse) modalUse.style.display = "none";
    });

    // Soumission Formulaire Ajout
    const formAdd = document.getElementById("form-add-stock");
    if (formAdd && !formAdd.dataset.listenerAttached) {
        formAdd.dataset.listenerAttached = "true";
        formAdd.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                groupe_sanguin: document.getElementById("add-blood-group").value,
                composant: document.getElementById("add-component").value,
                volume_ml: parseInt(document.getElementById("add-volume").value, 10),
                date_collecte: document.getElementById("add-collection-date").value
            };

            const res = await fetch('/api/poches/enregistrer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast("Poche ajoutée avec succès", "success");
                if (modalAdd) modalAdd.style.display = "none";
                formAdd.reset();
                fetchStockData(token);
            } else {
                showToast("Erreur lors de l'ajout", "error");
            }
        });
    }

    // Soumission Formulaire Déstockage (FIFO)
    const formUse = document.getElementById("form-use-stock");
    if (formUse && !formUse.dataset.listenerAttached) {
        formUse.dataset.listenerAttached = "true";
        formUse.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                groupe_sanguin: document.getElementById("use-blood-group").value,
                quantite: parseInt(document.getElementById("use-quantity").value, 10),
                motif: document.getElementById("use-reason").value
            };

            const res = await fetch('/api/poches/utiliser', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                // AJOUT (audit) : le backend renvoie déjà les références
                // exactes des poches déstockées (poches_utilisees) — elles
                // étaient jusqu'ici ignorées côté frontend, rendant
                // impossible de savoir QUELLE poche avait été sortie.
                const refs = (data.poches_utilisees || [])
                    .map(id => `#${id.toString().slice(0, 8)}`)
                    .join(', ');
                showToast(
                    refs ? `Déstockage effectué : poche(s) ${refs}` : "Déstockage effectué avec succès",
                    "success"
                );
                if (modalUse) modalUse.style.display = "none";
                formUse.reset();
                fetchStockData(token);
                fetchUsedPockets(token);
            } else {
                showToast(data.message || "Erreur lors du déstockage", "error");
            }
        });
    }
};

// --- 5. TRAÇABILITÉ DES POCHES DÉSTOCKÉES ---
export const fetchUsedPockets = async (token) => {
    const tbody = document.getElementById("used-pockets-table-body");
    if (!tbody) return;

    try {
        const response = await fetch('/api/poches/utilisees', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Erreur de récupération");

        const poches = await response.json();

        tbody.innerHTML = "";
        if (poches.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Aucune poche déstockée pour le moment.</td></tr>`;
            return;
        }

        poches.forEach(p => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><code>#${p.id_poche.toString().slice(0, 8)}</code></td>
                <td><strong>${p.groupe_sanguin}</strong></td>
                <td>${p.composant}</td>
                <td>${p.volume_ml} ml</td>
                <td>${new Date(p.date_collecte).toLocaleDateString('fr-FR')}</td>
                <td>${new Date(p.date_peremption).toLocaleDateString('fr-FR')}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Erreur chargement poches déstockées :", err);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#dc2626;">Impossible de charger la traçabilité des poches.</td></tr>`;
    }
};