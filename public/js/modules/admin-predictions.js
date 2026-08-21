import { showToast } from './toast.js';

// AJOUT (audit) : l'espace Admin réutilisait jusqu'ici le même module que
// le tableau de bord hôpital (predictions.js), qui appelle
// GET /api/predictions/stock — une route réservée aux comptes hospitaliers
// (403 pour un SUPER_ADMIN, id_hopital = null). Ce module dédié consomme
// à la place les endpoints réseau, qui existaient déjà côté backend mais
// n'étaient appelés par aucun frontend :
//   - GET /api/predictions/reseau  (vue consolidée + suggestions de transfert)
//   - GET /api/predictions/alertes/reseau

export const initAdminPredictionsModule = async (token) => {
    setupRegionFilter(token);
    await fetchReseauPredictions(token, 'TOUTES');
    await fetchAlertesReseau(token);
};

const setupRegionFilter = (token) => {
    const select = document.getElementById("admin-prediction-region-filter");
    select?.addEventListener("change", () => {
        fetchReseauPredictions(token, select.value);
    });
};

// --- PRÉDICTIONS RÉSEAU + SUGGESTIONS DE TRANSFERT ---
const fetchReseauPredictions = async (token, region) => {
    const grid = document.getElementById("admin-prediction-hospitals-grid");
    const suggestionsBody = document.getElementById("admin-transfer-suggestions-body");
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Calcul des prédictions réseau...</div>`;

    try {
        const res = await fetch(`/api/predictions/reseau?region=${encodeURIComponent(region)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const data = await res.json();

        document.getElementById("admin-seuil-rupture").textContent = data.seuils.rupture_jours;
        document.getElementById("admin-seuil-peremption").textContent = data.seuils.peremption_jours;

        populateRegionFilter(data.hopitaux);
        renderHospitalCards(data.hopitaux || []);
        renderTransferSuggestions(data.suggestions_transfert || []);

    } catch (err) {
        console.error(err);
        if (grid) grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:#dc2626;">Impossible de charger les prédictions réseau.</p>`;
        if (suggestionsBody) suggestionsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#dc2626;">Erreur de chargement.</td></tr>`;
        showToast("Erreur lors du calcul des prédictions réseau", "error");
    }
};

// Peuple le filtre région une seule fois avec les régions réellement présentes
let regionsChargees = false;
const populateRegionFilter = (hopitaux) => {
    if (regionsChargees) return;
    const select = document.getElementById("admin-prediction-region-filter");
    if (!select) return;

    const regions = [...new Set((hopitaux || []).map(h => h.region).filter(Boolean))].sort();
    regions.forEach(region => {
        const option = document.createElement("option");
        option.value = region;
        option.textContent = region;
        select.appendChild(option);
    });
    regionsChargees = true;
};

const renderHospitalCards = (hopitaux) => {
    const grid = document.getElementById("admin-prediction-hospitals-grid");
    if (!grid) return;

    if (hopitaux.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:#64748b;">Aucun établissement actif pour cette région.</p>`;
        return;
    }

    grid.innerHTML = "";
    hopitaux.forEach(h => {
        const risques = (h.predictions || []).filter(p => p.statut !== 'STABLE' && p.statut !== 'DONNEES_INSUFFISANTES');

        const card = document.createElement("div");
        card.className = "stat-card";
        card.style.textAlign = "left";

        const lignesRisque = risques.length > 0
            ? risques.map(p => {
                const couleur = p.statut === 'RUPTURE_IMMINENTE' ? '#dc2626' : '#d97706';
                const label = p.statut === 'RUPTURE_IMMINENTE' ? 'Rupture' : 'Surplus à risque';
                return `<div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-top:4px;">
                    <span><strong>${p.groupe_sanguin}</strong></span>
                    <span style="color:${couleur}; font-weight:600;">${label}</span>
                </div>`;
            }).join('')
            : `<p style="font-size:0.8rem; color:#16a34a; margin-top:6px;"><i class="fa-solid fa-check-circle"></i> Stock stable</p>`;

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4 style="margin:0;">${h.nom_hopital}</h4>
                <span style="font-size:0.75rem; color:#64748b;">${h.region || '—'}</span>
            </div>
            ${lignesRisque}
        `;
        grid.appendChild(card);
    });
};

const renderTransferSuggestions = (suggestions) => {
    const tbody = document.getElementById("admin-transfer-suggestions-body");
    if (!tbody) return;

    if (suggestions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucun transfert suggéré pour le moment — réseau équilibré.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    suggestions.forEach(s => {
        const tr = document.createElement("tr");
        const urgent = s.jours_avant_perte <= 3;
        tr.innerHTML = `
            <td><strong>${s.groupe_sanguin}</strong></td>
            <td>${s.hopital_source.nom}</td>
            <td>${s.hopital_cible.nom}</td>
            <td>${s.poches_disponibles_a_transferer} poche(s)</td>
            <td><span class="badge-status ${urgent ? 'crit' : 'warn'}">${s.jours_avant_perte} j avant perte</span></td>
        `;
        tbody.appendChild(tr);
    });
};

// --- ALERTES RÉSEAU ---
const fetchAlertesReseau = async (token) => {
    const tbody = document.getElementById("admin-alertes-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement...</td></tr>`;

    try {
        const res = await fetch('/api/predictions/alertes/reseau', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const alertes = await res.json();
        renderAlertesReseau(alertes);

    } catch (err) {
        console.error(err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#dc2626;">Erreur de chargement.</td></tr>`;
    }
};

const renderAlertesReseau = (alertes) => {
    const tbody = document.getElementById("admin-alertes-table-body");
    if (!tbody) return;

    if (alertes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucune alerte réseau pour le moment.</td></tr>`;
        return;
    }

    const libelles = {
        'RUPTURE_IMMINENTE': 'Rupture prévue',
        'SURPLUS_A_RISQUE': 'Surplus à risque',
        'PEREMPTION_IMMINENTE': 'Péremption imminente'
    };

    tbody.innerHTML = "";
    alertes.forEach(a => {
        const tr = document.createElement("tr");
        const badgeClass = a.type_alerte === 'RUPTURE_IMMINENTE' ? 'status-recue' : 'status-emise';

        tr.innerHTML = `
            <td><span class="badge ${badgeClass}">${libelles[a.type_alerte] || a.type_alerte}</span></td>
            <td>${a.nom_hopital}</td>
            <td><strong>${a.groupe_sanguin || '—'}</strong></td>
            <td>${a.message}</td>
            <td>${new Date(a.date_creation).toLocaleString('fr-FR')}</td>
        `;
        tbody.appendChild(tr);
    });
};
