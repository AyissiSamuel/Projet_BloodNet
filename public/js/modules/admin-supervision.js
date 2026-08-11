import { showToast } from './toast.js';

let allHospitalsData = [];

export const initAdminSupervisionModule = async (token) => {
    setupRegionFilter(token);
    await fetchRegionalData('TOUTES', token);
};

// --- 1. ÉCOUTE DU SÉLECTEUR DE RÉGION ---
const setupRegionFilter = (token) => {
    const regionSelect = document.getElementById("admin-region-select");
    regionSelect?.addEventListener("change", (e) => {
        const region = e.target.value;
        document.getElementById("selected-region-label").textContent = region === 'TOUTES' ? 'Toutes les Régions' : region;
        fetchRegionalData(region, token);
    });

    // Recherche textuelle dans le tableau
    document.getElementById("hospital-search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allHospitalsData.filter(h => 
            h.nom_hopital.toLowerCase().includes(query) || 
            h.region.toLowerCase().includes(query)
        );
        renderHospitalsTable(filtered, token);
    });
};

// --- 2. RÉCUPÉRATION DES DONNÉES DE LA ZONE VIA L'API ---
const fetchRegionalData = async (region, token) => {
    const tbody = document.getElementById("admin-hospitals-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des données de la zone...</td></tr>`;

    try {
        const res = await fetch(`/api/admin/supervision?region=${encodeURIComponent(region)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Accès refusé ou erreur serveur");

        const data = await res.json();
        // data = { consolidatedStock: { 'O+': 45, 'O-': 5, ... }, hospitals: [...] }

        renderConsolidatedStock(data.consolidatedStock);
        allHospitalsData = data.hospitals || [];
        renderHospitalsTable(allHospitalsData, token);

    } catch (err) {
        console.error("Erreur supervision:", err);
        showToast("Erreur lors du chargement des données de la région", "error");
    }
};

// --- 3. RENDU DES CARTES DU STOCK CONSOLIDÉ ---
const renderConsolidatedStock = (stockData = {}) => {
    const container = document.getElementById("regional-stock-cards");
    if (!container) return;

    const bloodGroups = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
    container.innerHTML = "";

    bloodGroups.forEach(group => {
        const total = stockData[group] || 0;
        const isCritical = total < 5; // Alerte si moins de 5 poches dans toute la zone

        const card = document.createElement("div");
        card.style.cssText = `
            background: #fff; 
            padding: 12px; 
            border-radius: 8px; 
            border: 1px solid ${isCritical ? '#fca5a5' : '#cbd5e1'}; 
            border-left: 4px solid ${isCritical ? '#dc2626' : '#2563eb'};
            text-align: center;
        `;
        card.innerHTML = `
            <div style="font-size: 1.2rem; font-weight: 800; color: ${isCritical ? '#dc2626' : '#0f172a'};">${group}</div>
            <div style="font-size: 1.5rem; font-weight: 700; margin: 5px 0;">${total} <small style="font-size: 0.75rem;">poches</small></div>
            <span class="badge ${isCritical ? 'status-critique' : 'status-ok'}" style="font-size: 0.7rem;">
                ${isCritical ? 'ALERTE PÉNURIE' : 'DISPONIBLE'}
            </span>
        `;
        container.appendChild(card);
    });
};

// --- 4. RENDU DU TABLEAU DES HÔPITAUX ---
const renderHospitalsTable = (hospitals, token) => {
    const tbody = document.getElementById("admin-hospitals-table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!hospitals || hospitals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Aucun hôpital trouvé dans cette zone.</td></tr>`;
        return;
    }

    hospitals.forEach(h => {
        const tr = document.createElement("tr");
        
        // Valeurs réelles de hopitaux.statut (chk_hopital_statut) :
        // EN_ATTENTE, ACTIF, DESACTIVE
        let statusBadge = `<span class="badge-status ok">ACTIF</span>`;
        if (h.statut_validation === 'EN_ATTENTE') statusBadge = `<span class="badge-status warn">EN ATTENTE</span>`;
        if (h.statut_validation === 'DESACTIVE') statusBadge = `<span class="badge-status crit">DÉSACTIVÉ</span>`;

        tr.innerHTML = `
            <td><strong>${h.nom_hopital}</strong></td>
            <td>${h.region}</td>
            <td>${h.telephone}</td>
            <td><strong>${h.total_stock || 0} poches</strong></td>
            <td>${h.derniere_activite ? new Date(h.derniere_activite).toLocaleDateString('fr-FR') : 'Aucune'}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn-sm btn-secondary btn-audit-hospital" data-id="${h.id_hopital}" data-name="${h.nom_hopital}">
                    <i class="fa-solid fa-eye"></i> Audit Stock
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attacher l'événement pour auditer un hôpital en particulier
    document.querySelectorAll(".btn-audit-hospital").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            openHospitalDetailModal(id, name, token);
        });
    });
};

// --- 5. MODALE DÉTAIL D'UN HÔPITAL ---
const openHospitalDetailModal = async (id_hopital, nom_hopital, token) => {
    document.getElementById("modal-hospital-name").textContent = nom_hopital;
    const modal = document.getElementById("modal-hospital-detail");
    const container = document.getElementById("hospital-stock-breakdown");
    
    container.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Chargement du stock détaillé...`;
    modal.style.display = "flex";

    try {
        const res = await fetch(`/api/admin/hopital/${id_hopital}/stock`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error();

        const stockDetails = await res.json(); // ex: [{ groupe_sanguin: 'O+', quantite: 12 }, ...]
        container.innerHTML = "";

        stockDetails.forEach(item => {
            const div = document.createElement("div");
            div.style.cssText = "background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #cbd5e1;";
            div.innerHTML = `<strong>${item.groupe_sanguin}</strong><br><span style="font-size: 1.2rem; color: #dc2626; font-weight: bold;">${item.quantite}</span> poches`;
            container.appendChild(div);
        });

    } catch (err) {
        container.innerHTML = `<span style="color: #dc2626;">Erreur lors de la récupération du stock.</span>`;
    }

    document.getElementById("close-hospital-detail-modal").onclick = () => modal.style.display = "none";
};