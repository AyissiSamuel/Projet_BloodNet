import { showToast } from './toast.js';

export const initAdminZonesModule = async (token) => {
    document.getElementById("zone-region-filter")?.addEventListener("change", (e) => {
        fetchActivite(token, e.target.value);
    });
    await fetchActivite(token, 'TOUTES');
};

const fetchActivite = async (token, region) => {
    const container = document.getElementById("zones-container");
    if (container) container.innerHTML = `<div style="text-align:center; padding:2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement de l'activité du réseau...</div>`;

    try {
        const res = await fetch(`/api/admin/hopitaux/activite?region=${encodeURIComponent(region)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const data = await res.json();
        renderZones(data.par_region || {});

    } catch (err) {
        console.error(err);
        if (container) container.innerHTML = `<p style="color:#dc2626; text-align:center;">Impossible de charger l'activité des établissements.</p>`;
        showToast("Erreur lors du chargement", "error");
    }
};

const renderZones = (parRegion) => {
    const container = document.getElementById("zones-container");
    if (!container) return;

    const regions = Object.keys(parRegion);

    if (regions.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:#64748b;">Aucun établissement trouvé pour cette sélection.</p>`;
        return;
    }

    container.innerHTML = "";
    regions.forEach(region => {
        const hopitaux = parRegion[region];

        const block = document.createElement("div");
        block.className = "card-box";
        block.style.marginBottom = "1.5rem";

        const rows = hopitaux.map(h => {
            const derniereActivite = h.derniere_activite
                ? new Date(h.derniere_activite).toLocaleDateString('fr-FR')
                : 'Aucune activité récente';

            const badgeStatut = h.statut === 'ACTIF'
                ? `<span class="badge-status ok">ACTIF</span>`
                : h.statut === 'EN_ATTENTE'
                    ? `<span class="badge-status warn">EN ATTENTE</span>`
                    : `<span class="badge-status crit">DÉSACTIVÉ</span>`;

            return `
                <tr>
                    <td><strong>${h.nom_hopital}</strong><br><small style="color:#94a3b8;">${h.telephone || '—'}</small></td>
                    <td>${badgeStatut}</td>
                    <td style="text-align:center;">${h.dons_30j}</td>
                    <td style="text-align:center;">${h.commandes_emises_30j}</td>
                    <td style="text-align:center;">${h.commandes_recues_30j}</td>
                    <td>${derniereActivite}</td>
                </tr>
            `;
        }).join('');

        block.innerHTML = `
            <div class="table-header">
                <h3><i class="fa-solid fa-map-pin"></i> ${region} <span style="color:#94a3b8; font-weight:400;">(${hopitaux.length} établissement(s))</span></h3>
            </div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Établissement</th>
                            <th>Statut</th>
                            <th style="text-align:center;">Dons (30j)</th>
                            <th style="text-align:center;">Commandes émises (30j)</th>
                            <th style="text-align:center;">Commandes reçues (30j)</th>
                            <th>Dernière activité</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
        container.appendChild(block);
    });
};
