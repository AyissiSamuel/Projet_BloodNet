import { showToast } from './toast.js';

export const initAdminHopitauxModule = async (token) => {
    setupConfirmModal(token);
    await fetchHopitaux(token);
};

// --- RÉCUPÉRATION DES DONNÉES ---
const fetchHopitaux = async (token) => {
    const pendingBody = document.getElementById("pending-hospitals-table-body");
    const allBody = document.getElementById("all-hospitals-table-body");

    if (pendingBody) pendingBody.innerHTML = `<tr><td colspan="5" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement...</td></tr>`;

    try {
        const [pendingRes, allRes] = await Promise.all([
            fetch('/api/admin/hopitaux/en-attente', { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch('/api/hospitals/all', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (!pendingRes.ok || !allRes.ok) throw new Error("Erreur serveur");

        const pending = await pendingRes.json();
        const all = await allRes.json();

        document.getElementById("pending-hospitals-count").textContent = pending.length;

        renderPendingTable(pending, token);
        renderAllTable(all.filter(h => h.statut !== 'EN_ATTENTE'), token);

    } catch (err) {
        console.error(err);
        if (pendingBody) pendingBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#dc2626;">Erreur de chargement.</td></tr>`;
        showToast("Impossible de charger les établissements", "error");
    }
};

// --- TABLEAU DES DEMANDES EN ATTENTE ---
const renderPendingTable = (hopitaux, token) => {
    const tbody = document.getElementById("pending-hospitals-table-body");
    if (!tbody) return;

    if (hopitaux.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucune demande en attente.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    hopitaux.forEach(h => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${h.nom}</strong></td>
            <td>${h.adresse || '—'}</td>
            <td>${h.telephone || '—'}</td>
            <td>${h.region || 'Non renseignée'}</td>
            <td>
                <button class="btn-sm btn-success btn-validate-hopital" data-id="${h.id_hopital}" data-nom="${h.nom}">
                    <i class="fa-solid fa-check"></i> Valider
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-validate-hopital").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const { id, nom } = e.currentTarget.dataset;
            openConfirmModal({
                message: `Confirmer l'activation du compte de "${nom}" ? L'établissement pourra ensuite accéder à la plateforme.`,
                action: async () => {
                    await patchHopitalStatut(id, 'valider', token);
                }
            });
        });
    });
};

// --- TABLEAU DU RÉSEAU (ACTIFS / DÉSACTIVÉS) ---
const renderAllTable = (hopitaux, token) => {
    const tbody = document.getElementById("all-hospitals-table-body");
    if (!tbody) return;

    if (hopitaux.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Aucun établissement dans le réseau.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    hopitaux.forEach(h => {
        const tr = document.createElement("tr");
        const isActif = h.statut === 'ACTIF';
        const badge = isActif
            ? `<span class="badge-status ok">ACTIF</span>`
            : `<span class="badge-status crit">DÉSACTIVÉ</span>`;

        const actionBtn = isActif
            ? `<button class="btn-sm btn-danger btn-toggle-hopital" data-id="${h.id_hopital}" data-nom="${h.nom}" data-action="desactiver"><i class="fa-solid fa-ban"></i> Désactiver</button>`
            : `<button class="btn-sm btn-success btn-toggle-hopital" data-id="${h.id_hopital}" data-nom="${h.nom}" data-action="valider"><i class="fa-solid fa-check"></i> Réactiver</button>`;

        tr.innerHTML = `
            <td><strong>${h.nom}</strong></td>
            <td>${h.region || 'Non renseignée'}</td>
            <td>${h.telephone || '—'}</td>
            <td>${badge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-toggle-hopital").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const { id, nom, action } = e.currentTarget.dataset;
            const verbe = action === 'desactiver' ? 'désactiver' : 'réactiver';
            openConfirmModal({
                message: `Confirmer la ${verbe === 'désactiver' ? 'désactivation' : 'réactivation'} du compte de "${nom}" ?`,
                action: async () => {
                    await patchHopitalStatut(id, action, token);
                }
            });
        });
    });
};

// --- APPEL API DE CHANGEMENT DE STATUT ---
const patchHopitalStatut = async (id, action, token) => {
    try {
        const res = await fetch(`/api/admin/hopitaux/${id}/${action}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            showToast(`Établissement ${action === 'valider' ? 'validé' : 'désactivé'} avec succès`, "success");
            await fetchHopitaux(token);
        } else {
            showToast("Erreur lors de la mise à jour du statut", "error");
        }
    } catch (err) {
        showToast("Erreur serveur", "error");
    }
};

// --- MODALE DE CONFIRMATION GÉNÉRIQUE ---
let pendingAction = null;

const setupConfirmModal = () => {
    document.getElementById("close-confirm-hospital-modal")?.addEventListener("click", closeConfirmModal);
    document.getElementById("btn-cancel-hospital-action")?.addEventListener("click", closeConfirmModal);
    document.getElementById("btn-confirm-hospital-action")?.addEventListener("click", async () => {
        if (pendingAction) await pendingAction();
        closeConfirmModal();
    });
};

const openConfirmModal = ({ message, action }) => {
    document.getElementById("confirm-hospital-message").textContent = message;
    pendingAction = action;
    document.getElementById("modal-confirm-hospital").style.display = "flex";
};

const closeConfirmModal = () => {
    document.getElementById("modal-confirm-hospital").style.display = "none";
    pendingAction = null;
};
