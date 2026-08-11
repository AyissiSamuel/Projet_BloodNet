import { showToast } from './toast.js';

export const initPredictionsModule = async (token) => {
    await Promise.all([
        fetchPredictions(token),
        fetchAlertes(token)
    ]);
};

// --- PRÉDICTIONS PAR GROUPE SANGUIN ---
const fetchPredictions = async (token) => {
    const container = document.getElementById("prediction-cards");
    if (container) container.innerHTML = `<div style="text-align:center; padding:2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Calcul des prédictions...</div>`;

    try {
        const res = await fetch('/api/predictions/stock', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const data = await res.json();
        document.getElementById("seuil-rupture").textContent = data.seuils.rupture_jours;
        document.getElementById("seuil-peremption").textContent = data.seuils.peremption_jours;

        renderPredictionCards(data.predictions || []);

    } catch (err) {
        console.error(err);
        if (container) container.innerHTML = `<p style="color:#dc2626;">Impossible de charger les prédictions.</p>`;
        showToast("Erreur lors du calcul des prédictions", "error");
    }
};

const renderPredictionCards = (predictions) => {
    const container = document.getElementById("prediction-cards");
    if (!container) return;

    if (predictions.length === 0) {
        container.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color:#64748b;">Aucune donnée suffisante pour établir une prédiction pour le moment.</p>`;
        return;
    }

    container.innerHTML = "";
    predictions.forEach(pred => {
        const card = document.createElement("div");
        card.className = "stat-card";

        let statusColor = "#16a34a";
        let statusLabel = "Stable";
        let icon = "fa-check-circle";

        if (pred.statut === 'RUPTURE_IMMINENTE') {
            statusColor = "#dc2626";
            statusLabel = "Rupture imminente";
            icon = "fa-triangle-exclamation";
        } else if (pred.statut === 'SURPLUS_A_RISQUE') {
            statusColor = "#d97706";
            statusLabel = "Surplus à risque";
            icon = "fa-hourglass-half";
        } else if (pred.statut === 'DONNEES_INSUFFISANTES') {
            statusColor = "#64748b";
            statusLabel = "Historique insuffisant";
            icon = "fa-circle-question";
        }

        const detailRupture = pred.jours_avant_rupture !== null
            ? `Rupture estimée dans <strong>${pred.jours_avant_rupture}</strong> jour(s)`
            : `Pas de tendance de rupture détectée`;

        const detailSurplus = pred.poches_a_risque.length > 0
            ? `<br><span style="color:#d97706;"><i class="fa-solid fa-hourglass-half"></i> ${pred.poches_a_risque.length} poche(s) à risque de péremption</span>`
            : '';

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h4 style="margin:0;">${pred.groupe_sanguin}</h4>
                <i class="fa-solid ${icon}" style="color:${statusColor};"></i>
            </div>
            <p style="font-size:0.8rem; color:${statusColor}; font-weight:600; margin: 4px 0;">${statusLabel}</p>
            <p style="font-size:0.85rem; color:#475569; margin:0;">Stock actuel : <strong>${pred.stock_actuel}</strong> poche(s)</p>
            <p style="font-size:0.8rem; color:#64748b; margin-top:6px;">${detailRupture}${detailSurplus}</p>
        `;
        container.appendChild(card);
    });
};

// --- ALERTES ---
const fetchAlertes = async (token) => {
    const tbody = document.getElementById("alertes-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement...</td></tr>`;

    try {
        const res = await fetch('/api/predictions/alertes', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const alertes = await res.json();
        renderAlertesTable(alertes, token);

    } catch (err) {
        console.error(err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#dc2626;">Erreur de chargement.</td></tr>`;
    }
};

const renderAlertesTable = (alertes, token) => {
    const tbody = document.getElementById("alertes-table-body");
    if (!tbody) return;

    if (alertes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucune alerte pour le moment. Stock sain !</td></tr>`;
        return;
    }

    const libelles = {
        'RUPTURE_PREVUE': 'Rupture prévue',
        'SURPLUS_A_RISQUE': 'Surplus à risque',
        'PEREMPTION_IMMINENTE': 'Péremption imminente'
    };

    tbody.innerHTML = "";
    alertes.forEach(a => {
        const tr = document.createElement("tr");
        const badgeClass = a.type_alerte === 'RUPTURE_PREVUE' ? 'status-critique' : 'status-emise';

        tr.innerHTML = `
            <td><span class="badge ${badgeClass}">${libelles[a.type_alerte] || a.type_alerte}</span></td>
            <td><strong>${a.groupe_sanguin || '—'}</strong></td>
            <td>${a.message}</td>
            <td>${new Date(a.date_creation).toLocaleString('fr-FR')}</td>
            <td>
                ${a.lue_hopital
                    ? `<span class="badge-status ok">Lue</span>`
                    : `<button class="btn-sm btn-secondary btn-marquer-lue" data-id="${a.id_alerte}">Marquer comme lue</button>`
                }
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-marquer-lue").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const id = e.currentTarget.dataset.id;
            try {
                const res = await fetch(`/api/predictions/alertes/${id}/lue`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    await fetchAlertes(token);
                } else {
                    showToast("Erreur lors du marquage", "error");
                }
            } catch (err) {
                showToast("Erreur serveur", "error");
            }
        });
    });
};
