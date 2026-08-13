// ./public/js/modules/settings.js
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
    setupAddUserForm(token);
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
            const isActif = u.statut_compte === 'ACTIF';
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${u.nom || u.email}</strong></td>
                <td><span class="badge status-emise">${u.role}</span></td>
                <td><span class="badge-status ${isActif ? 'ok' : 'critique'}">${u.statut_compte}</span></td>
                <td>
                    <button class="btn-sm ${isActif ? 'btn-secondary' : 'btn-primary'} btn-toggle-status" 
                            data-id="${u.id_utilisateur}" 
                            data-statut="${isActif ? 'SUSPENDU' : 'ACTIF'}">
                        <i class="fa-solid ${isActif ? 'fa-user-slash' : 'fa-user-check'}"></i> 
                        ${isActif ? 'Suspendre' : 'Activer'}
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Écouteurs pour suspension / réactivation
        document.querySelectorAll('.btn-toggle-status').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const userId = e.currentTarget.dataset.id;
                const newStatus = e.currentTarget.dataset.statut;

                try {
                    const toggleRes = await fetch(`/api/utilisateurs/${userId}/statut`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ statut: newStatus })
                    });

                    if (toggleRes.ok) {
                        showToast(`Compte ${newStatus === 'ACTIF' ? 'activé' : 'suspendu'}`, "info");
                        fetchUsersList(token);
                    } else {
                        showToast("Erreur lors de la modification", "error");
                    }
                } catch (err) {
                    showToast("Erreur serveur", "error");
                }
            });
        });

    } catch (err) {
        console.error("Erreur utilisateurs:", err);
    }
};

// 3bis. AJOUT D'UN UTILISATEUR (Agent / Gestionnaire / Admin établissement)
// Câble le formulaire #form-add-user présent dans settings.html, qui
// n'était relié à aucun script : le bouton "Créer le compte" ne faisait
// donc jamais d'appel API et aucun utilisateur n'était réellement créé.
const setupAddUserForm = (token) => {
    const openBtn = document.getElementById("btn-open-add-user");
    const cancelBtn = document.getElementById("btn-cancel-add-user");
    const card = document.getElementById("add-user-card");
    const form = document.getElementById("form-add-user");

    if (!form || !card) return;

    const resetForm = () => {
        form.reset();
        card.style.display = "none";
    };

    openBtn?.addEventListener("click", () => {
        card.style.display = card.style.display === "none" ? "block" : "none";
    });

    cancelBtn?.addEventListener("click", () => resetForm());

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('button[type="submit"]');
        const nom = document.getElementById("new-user-name").value.trim();
        const email = document.getElementById("new-user-email").value.trim();
        const password = document.getElementById("new-user-password").value;
        const role = document.getElementById("new-user-role").value;

        if (!nom || !email || !password || !role) {
            showToast("Veuillez remplir tous les champs.", "error");
            return;
        }

        if (submitBtn) submitBtn.disabled = true;

        try {
            const res = await fetch('/api/utilisateurs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nom, email, password, role })
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showToast(data.message || "Erreur lors de la création de l'utilisateur.", "error");
                return;
            }

            showToast("Utilisateur créé avec succès.", "success");
            resetForm();
            fetchUsersList(token); // Rafraîchit immédiatement la liste
        } catch (err) {
            console.error("Erreur création utilisateur :", err);
            showToast("Erreur de connexion au serveur.", "error");
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
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