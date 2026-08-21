import { checkAuth, logout } from './modules/auth.js';
import { showToast } from './modules/toast.js';
import { initStockModule } from './modules/stock.js';
import { initOrdersModule } from './modules/orders.js';
import { initDonorsModule } from './modules/donors.js';
import { initSettingsModule } from './modules/settings.js';
import { initPredictionsModule } from './modules/predictions.js';

document.addEventListener('DOMContentLoaded', () => {
    const token = checkAuth();

    // Dynamisation du profil utilisateur et de la structure hôpital
    try {
        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
        
        if (userInfo.role === 'SUPER_ADMIN') {
            window.location.href = "/admin.html";
            return;
        }

        // Mise à jour de l'hôpital connecté
        const hospitalNameElement = document.querySelector('.topbar-left .hospital-name');
        if (hospitalNameElement && userInfo.nom_hopital) {
            hospitalNameElement.innerHTML = `<i class="fa-solid fa-hospital" aria-hidden="true"></i> ${userInfo.nom_hopital}`;
        }

        // Mise à jour du badge/avatar utilisateur
        const avatarElement = document.querySelector('.user-avatar');
        if (avatarElement && userInfo.nom) {
            const initials = userInfo.nom.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            avatarElement.textContent = initials;
            avatarElement.title = `Session : ${userInfo.nom}`;
        }
    } catch (e) {
        console.error("Erreur d'initialisation de la session utilisateur :", e);
    }

    // Navigation de la sidebar
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            const viewName = item.getAttribute('data-target');
            loadView(viewName, token);
        });
    });

    // Déconnexion
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // Chargement de la vue initiale
    loadView('dashboard-home', token);
});

async function loadView(viewName, token) {
    const mainContent = document.getElementById('app-content');
    mainContent.innerHTML = `
        <div class="loading-spinner">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Chargement de votre espace...
        </div>
    `;

    try {
        const response = await fetch(`/view/${viewName}.html`);
        if (!response.ok) throw new Error(`Vue non trouvée: ${response.status}`);

        const html = await response.text();
        mainContent.innerHTML = html;

        // Exécution des modules selon la vue injectée
        switch (viewName) {
            case 'dashboard-home':
                initStockModule(token, true); // KPIs du tableau de bord
                break;

            case 'stock':
                initStockModule(token, false); // Vue détaillée du stock
                break;

            case 'orders':
                initOrdersModule(token);
                break;

            case 'donors':
                initDonorsModule(token);
                break;

            case 'predictions':
                initPredictionsModule(token);
                break;

            case 'settings':
                initSettingsModule(token);
                break;
        }

    } catch (error) {
        console.error("Erreur lors du chargement de la vue :", error);
        mainContent.innerHTML = `
            <div class="error-state" style="text-align: center; padding: 3rem;">
                <i class="fa-solid fa-triangle-exclamation fa-2x" style="color: var(--danger-color, #e74c3c);"></i>
                <p style="margin-top: 1rem;">Impossible de charger la vue <strong>${viewName}</strong>.</p>
            </div>
        `;
        showToast("Erreur lors du chargement de la vue", "error");
    }
}