//Stock.js
import { showToast } from './toast.js';

let chartInstance = null;
let dashboardMapInstance = null;

// --- GESTION DES FILTRES DE STOCK ---
const setupFilterEvents = (token) => {
    const filterInput = document.getElementById("filter-blood-group");
    if (filterInput && !filterInput.dataset.listenerAttached) {
        filterInput.dataset.listenerAttached = "true";
        filterInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase();
            const rows = document.querySelectorAll("#stock-table-body tr");
            rows.forEach(row => {
                const groupText = row.querySelector("td")?.textContent.toLowerCase() || "";
                row.style.display = groupText.includes(query) ? "" : "none";
            });
        });
    }
};

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

        await loadHospitalsOnMap(dashboardMapInstance, token);
    }

    setupStockEvents(token);

    if (isDashboardHome) {
        await fetchStockData(token);
        await fetchDashboardKPIs(token);
        await fetchAffiliatedHospitalsStock(token);
    } else {
        setupFilterEvents(token);
        await fetchStockData(token);
        await fetchUsedPockets(token);
    }
};

// --- CARTE : HÔPITAUX AFFILIÉS ---
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

// --- MISE À JOUR DES KPI ---
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
        ["kpi-total-stock", "kpi-critical-stock", "kpi-pending-orders", "kpi-active-donors"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = "N/A";
        });
    }
};

// --- CHARGEMENT DU STOCK ---
const fetchStockData = async (token) => {
    try {
        const response = await fetch('/api/stocks/aggregated', {
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

// --- RENDU DU TABLEAU ET CARTE DES STOCKS ---
const renderStockTableAndCards = (data) => {
    const tbody = document.getElementById("stock-table-body");
    const cardsContainer = document.getElementById("stock-stat-cards");

    if (tbody) {
        tbody.innerHTML = "";
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucun stock disponible pour le moment.</td></tr>`;
        } else {
            data.forEach(item => {
                const group = item.blood_group || "N/A";
                const count = parseInt(item.total_count, 10) || 0;
                const volume = parseInt(item.total_volume, 10) || 0;
                const estCritique = count <= 5;

                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><strong class="badge-blood">${group}</strong></td>
                    <td>${count} poche(s)</td>
                    <td>${volume.toLocaleString('fr-FR')} mL</td>
                    <td>
                        <span class="status-badge ${estCritique ? 'status-low' : 'status-ok'}">
                            ${estCritique ? 'Critique' : 'En Stock'}
                        </span>
                    </td>
                    <td>
                        <button class="btn-sm btn-danger btn-use-stock" data-group="${group}" ${count === 0 ? 'disabled' : ''}>
                            <i class="fa-solid fa-arrow-right-from-bracket"></i> Sortir
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });

            document.querySelectorAll(".btn-use-stock").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    openUseModal(e.currentTarget.dataset.group);
                });
            });
        }
    }

    if (cardsContainer) {
        cardsContainer.innerHTML = "";
        data.forEach(item => {
            const card = document.createElement("div");
            card.className = "stat-card";
            card.innerHTML = `
                <h3>${item.blood_group}</h3>
                <p class="count">${item.total_count} poche(s)</p>
                <small>${(item.total_volume || 0).toLocaleString('fr-FR')} mL au total</small>
            `;
            cardsContainer.appendChild(card);
        });
    }
};

// --- GRAPHIQUE CHART.JS ---
const renderStockChart = (data) => {
    const ctx = document.getElementById("stockChart");
    if (!ctx || typeof Chart === 'undefined') return;

    const labels = data.map(item => item.blood_group);
    const quantities = data.map(item => parseInt(item.total_count, 10) || 0);

    // Utilisation de la variable du module chartInstance
    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Poches disponibles',
                data: quantities,
                backgroundColor: 'rgba(220, 38, 38, 0.75)',
                borderColor: 'rgba(220, 38, 38, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
};

// --- STOCK DES HÔPITAUX AFFILIÉS ---
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

// --- MODALES ET ÉVÉNEMENTS ---
const openUseModal = (group) => {
    const inputGroup = document.getElementById("use-blood-group");
    const displayGroup = document.getElementById("use-group-display");
    
    if (inputGroup) inputGroup.value = group;
    if (displayGroup) displayGroup.textContent = group;
    
    const modalUse = document.getElementById("modal-use-stock");
    if (modalUse) modalUse.style.display = "flex";
};

const setupStockEvents = (token) => {
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

    const modalUse = document.getElementById("modal-use-stock");
    document.getElementById("close-use-modal")?.addEventListener("click", () => {
        if (modalUse) modalUse.style.display = "none";
    });
    document.getElementById("cancel-use-modal")?.addEventListener("click", () => {
        if (modalUse) modalUse.style.display = "none";
    });

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

// --- TRAÇABILITÉ DES POCHES DÉSTOCKÉES ---
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