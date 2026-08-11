import { showToast } from './toast.js';

export const initAdminSettingsModule = async (token) => {
    setupAddAdminModal(token);
    setupChangePasswordForm(token);
    await fetchAdministrateurs(token);
};

// --- LISTE DES ADMINISTRATEURS ---
const fetchAdministrateurs = async (token) => {
    const tbody = document.getElementById("admins-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement...</td></tr>`;

    try {
        const res = await fetch('/api/admin/administrateurs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const admins = await res.json();
        renderAdminsTable(admins);

    } catch (err) {
        console.error(err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#dc2626;">Erreur de chargement.</td></tr>`;
    }
};

const renderAdminsTable = (admins) => {
    const tbody = document.getElementById("admins-table-body");
    if (!tbody) return;

    if (admins.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Aucun administrateur trouvé.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    admins.forEach(a => {
        const tr = document.createElement("tr");
        const badge = a.statut_compte === 'ACTIF'
            ? `<span class="badge-status ok">ACTIF</span>`
            : `<span class="badge-status crit">SUSPENDU</span>`;

        tr.innerHTML = `
            <td><strong>${a.nom}</strong></td>
            <td>${a.email}</td>
            <td>${badge}</td>
            <td>${new Date(a.date_inscription).toLocaleDateString('fr-FR')}</td>
        `;
        tbody.appendChild(tr);
    });
};

// --- AJOUT D'UN ADMINISTRATEUR ---
const setupAddAdminModal = (token) => {
    const modal = document.getElementById("modal-add-admin");

    document.getElementById("btn-open-add-admin")?.addEventListener("click", () => {
        modal.style.display = "flex";
    });
    document.getElementById("close-add-admin-modal")?.addEventListener("click", () => {
        modal.style.display = "none";
    });

    document.getElementById("form-add-admin")?.addEventListener("submit", async (e) => {
        e.preventDefault();

        const payload = {
            nom: document.getElementById("new-admin-nom").value,
            email: document.getElementById("new-admin-email").value,
            mot_de_passe: document.getElementById("new-admin-password").value
        };

        try {
            const res = await fetch('/api/admin/administrateurs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok) {
                showToast("Administrateur créé avec succès", "success");
                modal.style.display = "none";
                e.target.reset();
                await fetchAdministrateurs(token);
            } else {
                showToast(data.message || "Erreur lors de la création", "error");
            }
        } catch (err) {
            showToast("Erreur serveur", "error");
        }
    });
};

// --- CHANGEMENT DE MOT DE PASSE ---
const setupChangePasswordForm = (token) => {
    document.getElementById("form-change-password")?.addEventListener("submit", async (e) => {
        e.preventDefault();

        const current = document.getElementById("current-password").value;
        const newPass = document.getElementById("new-password").value;
        const confirmPass = document.getElementById("confirm-password").value;

        if (newPass !== confirmPass) {
            showToast("Les nouveaux mots de passe ne correspondent pas", "error");
            return;
        }

        try {
            const res = await fetch('/api/utilisateurs/mot-de-passe', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    ancien_mot_de_passe: current,
                    nouveau_mot_de_passe: newPass
                })
            });

            const data = await res.json();

            if (res.ok) {
                showToast("Mot de passe mis à jour avec succès", "success");
                e.target.reset();
            } else {
                showToast(data.message || "Erreur lors de la mise à jour", "error");
            }
        } catch (err) {
            showToast("Erreur serveur", "error");
        }
    });
};
