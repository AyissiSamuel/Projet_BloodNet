import { showToast } from './toast.js';

export const initSettingsModule = async (token) => {
    setupSettingsNavigation();
    setupThemeToggle();
    await fetchUsersList(token);
    setupSettingsForms(token);
};

// --- 1. NAVIGATION ENTRE LES PANNEAUX DE PARAMÈTRES ---
const setupSettingsNavigation = () => {
    const navBtns = document.querySelectorAll(".settings-nav-btn");
    const panes = document.querySelectorAll(".settings-pane");

    navBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            navBtns.forEach(b => {
                b.style.background = "transparent";
                b.style.color = "#64748b";
                b.classList.remove("active");
            });

            btn.style.background = "#f1f5f9";
            btn.style.color = "#0f172a";
            btn.classList.add("active");

            const targetPane = btn.getAttribute("data-pane");
            panes.forEach(pane => {
                pane.style.display = (pane.id === targetPane) ? "block" : "none";
            });
        });
    });
};

// --- 2. APPARENCE ET THÈME SOMBRE / CLAIR ---
const setupThemeToggle = () => {
    const radios = document.querySelectorAll('input[name="theme-mode"]');
    radios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            const mode = e.target.value;
            if (mode === "dark") {
                document.body.classList.add("dark-mode");
                localStorage.setItem("bloodnet_theme", "dark");
            } else {
                document.body.classList.remove("dark-mode");
                localStorage.setItem("bloodnet_theme", "light");
            }
            showToast(`Thème ${mode === 'dark' ? 'sombre' : 'clair'} appliqué`, "success");
        });
    });
};

// --- 3. CHARGEMENT DES UTILISATEURS ET AUTORISATIONS ---
const fetchUsersList = async (token) => {
    const tbody = document.getElementById("users-access-table-body");
    if (!tbody) return;

    try {
        const res = await fetch('/api/utilisateurs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) return;

        const users = await res.json();
        tbody.innerHTML = "";

        if (!users || users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Aucun utilisateur trouvé.</td></tr>`;
            return;
        }

        users.forEach(u => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${u.nom_utilisateur || u.email}</strong></td>
                <td><span class="badge status-emise">${u.role || 'OPERATEUR'}</span></td>
                <td><span class="badge-status ok">${u.actif ? 'ACTIF' : 'SUSPENDU'}</span></td>
                <td>
                    <button class="btn-sm btn-secondary btn-edit-user" data-id="${u.id_utilisateur}">
                        <i class="fa-solid fa-pen"></i> Droits
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Erreur utilisateurs:", err);
    }
};

// --- 4. FORMULAIRES ET SAUVEGARDE ---
const setupSettingsForms = (token) => {
    document.getElementById("form-profile-settings")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const payload = {
            nom_hopital: document.getElementById("setting-hospital-name").value,
            telephone: document.getElementById("setting-hospital-phone").value
        };

        try {
            const res = await fetch('/api/hopital/profil', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast("Profil mis à jour avec succès", "success");
            } else {
                showToast("Erreur lors de la mise à jour", "error");
            }
        } catch (err) {
            showToast("Erreur de connexion", "error");
        }
    });
};