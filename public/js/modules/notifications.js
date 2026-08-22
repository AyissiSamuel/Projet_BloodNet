// public/js/modules/notifications.js
//
// AJOUT (audit) : l'infrastructure Socket.io existait déjà côté backend
// (config/socket.js émettait déjà 'nouvelle_commande' et
// 'nouvelle_alerte_sos'), mais AUCUN fichier frontend ne chargeait
// socket.io-client ni n'écoutait ces événements — la cloche de
// notification du topbar (#notif-btn) était un élément purement décoratif
// ("3" codé en dur). Ce module connecte le socket, alimente un panneau
// déroulant, et affiche un toast pour chaque nouvel événement.

import { showToast } from './toast.js';

let notifications = [];
let socket = null;

export const initNotifications = (token, role) => {
    if (typeof io === 'undefined') {
        console.warn("socket.io-client non chargé : notifications temps réel désactivées.");
        return;
    }

    socket = io({ auth: { token } });

    socket.on('connect_error', (err) => {
        console.warn("Connexion temps réel indisponible :", err.message);
    });

    // --- Nouvelle commande reçue (hôpital vendeur) ---
    socket.on('nouvelle_commande', (payload) => {
        pushNotification('commande', payload.message);
        showToast(payload.message, "info");
    });

    // --- Nouvelle commande à arbitrer (admin) ---
    socket.on('nouvelle_commande_admin', (payload) => {
        pushNotification('commande', payload.message);
        showToast(payload.message, "info");
    });

    // --- Décision d'arbitrage (hôpitaux demandeur + vendeur) ---
    socket.on('commande_arbitree', (payload) => {
        pushNotification(payload.statut === 'ACCEPTEE' ? 'succes' : 'refus', payload.message);
        showToast(payload.message, payload.statut === 'ACCEPTEE' ? "success" : "error");
    });

    // --- Appel SOS diffusé à tout le réseau ---
    socket.on('nouvelle_alerte_sos', (payload) => {
        pushNotification('sos', payload.message);
        showToast(payload.message, "error");
        // Signale aux modules intéressés (ex: sos.js) qu'un nouveau SOS
        // vient d'arriver, pour qu'ils rafraîchissent leur propre affichage
        // sans coupler ce module directement à eux.
        window.dispatchEvent(new CustomEvent('bloodnet:nouveau-sos', { detail: payload }));
    });

    setupBell();
};

const pushNotification = (type, message) => {
    notifications.unshift({
        type,
        message,
        date: new Date(),
        lue: false
    });
    notifications = notifications.slice(0, 30); // on garde les 30 plus récentes
    renderBadge();
    renderPanel();
};

const ICONES = {
    commande: 'fa-solid fa-truck-fast',
    succes: 'fa-solid fa-circle-check',
    refus: 'fa-solid fa-circle-xmark',
    sos: 'fa-solid fa-triangle-exclamation'
};

const renderBadge = () => {
    const btn = document.getElementById("notif-btn");
    if (!btn) return;

    const nonLues = notifications.filter(n => !n.lue).length;
    let badge = btn.querySelector(".badge-count");

    if (nonLues === 0) {
        badge?.remove();
        return;
    }
    if (!badge) {
        badge = document.createElement("span");
        badge.className = "badge-count";
        btn.appendChild(badge);
    }
    badge.textContent = nonLues > 9 ? "9+" : nonLues;
};

const setupBell = () => {
    const btn = document.getElementById("notif-btn");
    if (!btn || btn.dataset.listenerAttached) return;
    btn.dataset.listenerAttached = "true";

    // Panneau déroulant créé dynamiquement (pas besoin de toucher au HTML
    // existant des deux topbars).
    const panel = document.createElement("div");
    panel.id = "notif-panel";
    panel.style.cssText = `
        position: absolute; top: 56px; right: 90px; width: 340px; max-height: 420px;
        overflow-y: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: none; z-index: 1000;
    `;
    document.body.appendChild(panel);

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        panel.style.display = panel.style.display === "none" ? "block" : "none";
        if (panel.style.display === "block") {
            notifications.forEach(n => n.lue = true);
            renderBadge();
            renderPanel();
        }
    });

    document.addEventListener("click", (e) => {
        if (!panel.contains(e.target) && e.target !== btn) {
            panel.style.display = "none";
        }
    });

    renderPanel();
};

const renderPanel = () => {
    const panel = document.getElementById("notif-panel");
    if (!panel) return;

    if (notifications.length === 0) {
        panel.innerHTML = `<div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.85rem;">Aucune notification pour le moment</div>`;
        return;
    }

    panel.innerHTML = notifications.map(n => `
        <div style="padding:10px 14px; border-bottom:1px solid #f1f5f9; display:flex; gap:10px; align-items:flex-start; ${n.lue ? '' : 'background:#fef2f2;'}">
            <i class="${ICONES[n.type] || 'fa-solid fa-bell'}" style="color:#DC2626; margin-top:3px;"></i>
            <div>
                <p style="margin:0; font-size:0.82rem; color:#1e293b; line-height:1.3;">${n.message}</p>
                <small style="color:#94a3b8;">${n.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
        </div>
    `).join('');
};
