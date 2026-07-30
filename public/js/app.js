// public/js/app.js
import { checkAuth, logout } from './modules/auth.js';
import { showToast } from './modules/toast.js';
import { initStockModule } from './modules/stock.js';
import { initOrdersModule } from './modules/orders.js';
import { initDonorsModule } from './modules/donors.js';
import { initSettingsModule } from './modules/settings.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Vérification du token d'authentification
    const token = checkAuth();

    // 2. Écoute des clics sur les liens du menu latéral
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            // Gestion de la classe CSS active sur la sidebar
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Récupération de l'attribut data-target="..."
            const viewName = item.getAttribute('data-target');

            // Chargement de la vue demandée
            loadView(viewName, token);
        });
    });

    // 3. Gestion de la déconnexion
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // 4. Chargement de la vue par défaut (Accueil du Dashboard)
    loadView('dashboard-home', token);
});

// 🔄 Fonction principale de chargement dynamique des vues HTML
async function loadView(viewName, token) {
    const mainContent = document.getElementById('app-content');

    // Display du loader pendant le téléchargement du fichier HTML
    mainContent.innerHTML = `
        <div class="loading-spinner">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Chargement de votre espace...
        </div>
    `;

    try {
        // Fetch du fragment HTML dans public/view/
        const response = await fetch(`/view/${viewName}.html`);

        if (!response.ok) {
            throw new Error(`Fichier /view/${viewName}.html introuvable (${response.status})`);
        }

        const html = await response.text();
        
        // Injection du HTML téléchargé dans la zone principale
        mainContent.innerHTML = html;

        // Initialisation des scripts JS propres à la vue injectée
        switch (viewName) {
            case 'dashboard-home':
                initStockModule(token, true); 
                break;

            case 'stock':
                initStockModule(token, false);
                break;

            case 'orders':
                initOrdersModule(token);
                break;

            case 'donors':
                initDonorsModule(token);
                break;

            case 'settings':
                initSettingsModule(token);
                break;

            default:
                console.warn(`Aucun module JS associé à la vue : ${viewName}`);
                break;
        }

    } catch (error) {
        console.error("Erreur lors du chargement de la vue :", error);
        
        // Affichage d'un message d'erreur propre au lieu de bloquer sur le spinner
        mainContent.innerHTML = `
            <div class="error-state" style="text-align: center; padding: 3rem;">
                <i class="fa-solid fa-triangle-exclamation fa-2x" style="color: var(--danger-color, #e74c3c);"></i>
                <p style="margin-top: 1rem;">Impossible de charger la vue <strong>${viewName}</strong>.</p>
                <small style="color: #777;">Vérifiez que le fichier <code>public/view/${viewName}.html</code> existe bien.</small>
            </div>
        `;
        
        showToast("Erreur lors du chargement de la vue", "error");
    }
}