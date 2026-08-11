import { showToast } from './toast.js';

export const initSettingsModule = (token) => {
    // Initialisation du toggle simple (si présent)
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const currentTheme = localStorage.getItem('theme') || 'light';
        if (currentTheme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggle.checked = true;
        }

        themeToggle.addEventListener('change', (e) => {
            const isDark = e.target.checked;
            document.body.classList.toggle('dark-mode', isDark);
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            showToast(`Thème ${isDark ? 'sombre' : 'clair'} activé`, "info");
        });
    }

    // Lancement de la navigation entre onglets, des formulaires et du chargement des utilisateurs
    setupSettingsNavigation();
    setupThemeToggle();
    setupSettingsForms(token);
    fetchUsersList(token);
};

// 1. NAVIGATION ENTRE PANNEAUX
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

// 2. CHOIX DU THÈME PAR RADIO
const setupThemeToggle = () => {
    const radios = document.querySelectorAll('input[name="theme-mode"]');
    radios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            const mode = e.target.value;
            const isDark = mode === "dark";
            document.body.classList.toggle("dark-mode", isDark);
            localStorage.setItem("bloodnet_theme", mode);
            showToast(`Thème ${isDark ? 'sombre' : 'clair'} appliqué`, "success");
        });
    });
};

// 3. CHARGEMENT UTILISATEURS
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
                <td><strong>${u.nom || u.email}</strong></td>
                <td><span class="badge status-emise">${u.role || 'PERSONNEL'}</span></td>
                <td><span class="badge-status ok">${u.statut_compte === 'ACTIF' ? 'ACTIF' : 'SUSPENDU'}</span></td>
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

// 4. FORMULAIRES DE CONFIGURATION
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