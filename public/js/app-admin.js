// public/js/app-admin.js
//
// Point d'entrée dédié à l'espace Administrateur (SUPER_ADMIN), séparé de
// app.js (espace Hôpital) pour garder une séparation claire des rôles côté
// frontend, cohérente avec la protection isSuperAdmin appliquée côté backend
// sur toutes les routes /api/admin/*.

import { checkAuth, logout } from './modules/auth.js';
import { showToast } from './modules/toast.js';
import { initAdminOrdersModule } from './modules/admin-orders.js';
import { initAdminSupervisionModule } from './modules/admin-supervision.js';
import { initAdminHopitauxModule } from './modules/admin-hopitaux.js';
import { initAdminZonesModule } from './modules/admin-zones.js';
import { initAdminSettingsModule } from './modules/admin-settings.js';
import { initAdminCarteModule } from './modules/admin-carte.js';
import { initPredictionsModule } from './modules/predictions.js';

document.addEventListener('DOMContentLoaded', () => {
    const token = checkAuth('SUPER_ADMIN');

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

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // Vue par défaut : Hôpitaux par zone
    loadView('admin-zones', token);
});

async function loadView(viewName, token) {
    const mainContent = document.getElementById('app-content');

    mainContent.innerHTML = `
        <div class="loading-spinner">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Chargement...
        </div>
    `;

    try {
        const response = await fetch(`/view/${viewName}.html`);

        if (!response.ok) {
            throw new Error(`Fichier /view/${viewName}.html introuvable (${response.status})`);
        }

        const html = await response.text();
        mainContent.innerHTML = html;

        switch (viewName) {
            case 'admin-hopitaux':
                initAdminHopitauxModule(token);
                break;

            case 'admin-zones':
                initAdminZonesModule(token);
                break;

            case 'admin-supervision':
                initAdminSupervisionModule(token);
                break;

            case 'admin-orders':
                initAdminOrdersModule(token);
                break;

            case 'predictions':
                initPredictionsModule(token);
                break;

            case 'admin-carte':
                initAdminCarteModule(token);
                break;

            case 'admin-settings':
                initAdminSettingsModule(token);
                break;

            default:
                console.warn(`Aucun module JS associé à la vue admin : ${viewName}`);
                break;
        }

    } catch (error) {
        console.error("Erreur lors du chargement de la vue admin :", error);
        mainContent.innerHTML = `
            <div class="error-state" style="text-align: center; padding: 3rem;">
                <i class="fa-solid fa-triangle-exclamation fa-2x" style="color: var(--danger-color, #e74c3c);"></i>
                <p style="margin-top: 1rem;">Impossible de charger la vue <strong>${viewName}</strong>.</p>
            </div>
        `;
        showToast("Erreur lors du chargement de la vue", "error");
    }
}
