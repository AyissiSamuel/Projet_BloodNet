import { showToast } from './toast.js';

let chartInstance = null;

export const initStockModule = async (token, isDashboardHome = false) => {
    // Initialisation conditionnelle de la carte (Voir Partie 2)
    const mapElement = document.getElementById('map');
    if (mapElement) {
        // Détruire l'instance Leaflet existante si elle a déjà été initialisée
        if (mapElement._leaflet_id) {
            mapElement._leaflet_id = null;
        }
        const map = L.map('map').setView([3.8480, 11.5021], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);
    }

    await fetchStockData(token);
    
    if (isDashboardHome) {
        await fetchRecentActivity(token);
    } else {
        await fetchStockHistory(token);
        setupStockEvents(token);
    }
};

// --- 1. CHARGEMENT DU STOCK ---
const fetchStockData = async (token) => {
    try {
        const response = await fetch('/api/stocks/aggregated', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error("Erreur de récupération du stock");

        const stockData = await response.json();
        renderStockTableAndCards(stockData);
        
        // On initialise le graphique seulement si l'élément canvas est présent dans le DOM
        if (document.getElementById("stockChart")) {
            renderStockChart(stockData);
        }
    } catch (err) {
        console.error(err);
        showToast("Impossible de charger les données du stock", "error");
    }
};

// --- 2. RENDU DU TABLEAU ET CARTE DES STOCKS ---
const renderStockTableAndCards = (stockItems) => {
    const tbody = document.getElementById("stock-table-body");
    const cardsContainer = document.getElementById("stock-stat-cards");

    if (tbody) tbody.innerHTML = "";
    if (cardsContainer) cardsContainer.innerHTML = "";

    if (!stockItems || stockItems.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucune poche en stock.</td></tr>`;
        return;
    }

    stockItems.forEach(item => {
        let status = "ok";
        let badgeLabel = "Suffisant";
        if (item.total_count <= 2) { status = "crit"; badgeLabel = "Critique"; }
        else if (item.total_count <= 5) { status = "warn"; badgeLabel = "Faible"; }

        // Cartes
        if (cardsContainer) {
            const card = document.createElement("div");
            card.className = `stat-card border-${status}`;
            card.innerHTML = `
                <div class="card-head"><span>${item.blood_group}</span><span class="status-badge ${status}">${badgeLabel}</span></div>
                <div class="card-body"><span class="card-qty">${item.total_count}</span> <small>poches</small></div>
            `;
            cardsContainer.appendChild(card);
        }

        // Tableau
        if (tbody) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${item.blood_group}</strong></td>
                <td>${item.total_count} poche(s)</td>
                <td>${(item.total_volume || 0).toLocaleString()} mL</td>
                <td><span class="badge-status ${status}">${badgeLabel}</span></td>
                <td>
                    <button class="btn-sm btn-danger btn-use-modal" data-group="${item.blood_group}">Déstocker</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });

    // Attacher les écouteurs sur les boutons "Déstocker"
    document.querySelectorAll(".btn-use-modal").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const group = e.target.getAttribute("data-group");
            openUseModal(group);
        });
    });
};

// --- 3. GRAPHIQUE CHART.JS ---
const renderStockChart = (stockItems) => {
    const ctx = document.getElementById('stockChart').getContext('2d');
    
    if (chartInstance) {
        chartInstance.destroy(); // Détruit l'ancien graphique pour éviter les superpositions
    }

    const labels = stockItems.map(i => i.blood_group);
    const dataVolumes = stockItems.map(i => i.total_volume || 0);

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Volume cumulé (mL)',
                data: dataVolumes,
                backgroundColor: 'rgba(225, 29, 72, 0.75)',
                borderColor: 'rgba(225, 29, 72, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
};

// --- 4. CHARGEMENT DE L'HISTORIQUE --
const fetchRecentActivity = async (token) => {
    try {
        const response = await fetch('/api/stocks/historique', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return;

        const history = await response.json();
        const tbody = document.getElementById("recent-orders-tbody");
        if (!tbody) return;

        tbody.innerHTML = "";
        if (history.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucun mouvement récent.</td></tr>`;
            return;
        }

        // Afficher les 5 derniers mouvements sur le Dashboard
        history.slice(0, 5).forEach(mvt => {
            const tr = document.createElement("tr");
            const isEntree = mvt.type_mouvement === 'ENTREE';
            tr.innerHTML = `
                <td><strong>${mvt.groupe_sanguin}</strong></td>
                <td>Hôpital / Banque Locale</td>
                <td>${mvt.quantite || 1} poche(s)</td>
                <td><span class="badge ${isEntree ? 'status-emise' : 'status-recue'}">${mvt.type_mouvement}</span></td>
                <td>${new Date(mvt.date_mouvement).toLocaleDateString('fr-FR')}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Erreur chargement mouvements récents :", err);
    }
};

// --- 5. GESTION DES MODALES ET ÉVÉNEMENTS ---
const openUseModal = (group) => {
    document.getElementById("use-blood-group").value = group;
    document.getElementById("use-group-display").textContent = group;
    document.getElementById("modal-use-stock").style.display = "flex";
};

const setupStockEvents = (token) => {
    // Modale d'ajout
    const modalAdd = document.getElementById("modal-add-stock");
    document.getElementById("btn-open-add-modal")?.addEventListener("click", () => modalAdd.style.display = "flex");
    document.getElementById("close-add-modal")?.addEventListener("click", () => modalAdd.style.display = "none");
    document.getElementById("cancel-add-modal")?.addEventListener("click", () => modalAdd.style.display = "none");

    // Modale de sortie
    const modalUse = document.getElementById("modal-use-stock");
    document.getElementById("close-use-modal")?.addEventListener("click", () => modalUse.style.display = "none");
    document.getElementById("cancel-use-modal")?.addEventListener("click", () => modalUse.style.display = "none");

    // Soumission Formulaire Ajout
    document.getElementById("form-add-stock")?.addEventListener("submit", async (e) => {
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
            modalAdd.style.display = "none";
            initStockModule(token, false);
        } else {
            showToast("Erreur lors de l'ajout", "error");
        }
    });

    // Soumission Formulaire Déstockage (FIFO)
    document.getElementById("form-use-stock")?.addEventListener("submit", async (e) => {
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

        if (res.ok) {
            showToast("Déstockage effectué avec succès", "success");
            modalUse.style.display = "none";
            initStockModule(token, false);
        } else {
            showToast("Erreur lors du déstockage", "error");
        }
    });
};