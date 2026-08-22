// public/js/modules/sos.js
//
// AJOUT (audit) : sosController.js (backend) gérait déjà tout — création,
// diffusion Socket.io temps réel, liste des SOS actifs — mais rien côté
// frontend n'appelait ces routes. Ce module ajoute le bouton de lancement
// et l'affichage temps réel des appels actifs du réseau.
import { showToast } from './toast.js';

export const initSosModule = async (token) => {
    setupSosModal(token);
    await fetchActiveSos(token);

    // Rafraîchissement en temps réel dès qu'un SOS est diffusé sur le
    // réseau (écouté globalement par notifications.js, qui déclenche cet
    // événement custom pour que ce module puisse réagir sans dépendance
    // circulaire directe au socket).
    window.addEventListener('bloodnet:nouveau-sos', () => fetchActiveSos(token));
};

const setupSosModal = (token) => {
    const modal = document.getElementById("modal-sos");
    const form = document.getElementById("form-sos");
    if (!modal || !form || form.dataset.listenerAttached) return;
    form.dataset.listenerAttached = "true";

    document.getElementById("btn-open-sos-modal")?.addEventListener("click", () => {
        modal.style.display = "flex";
    });
    document.getElementById("close-sos-modal")?.addEventListener("click", () => modal.style.display = "none");
    document.getElementById("cancel-sos-modal")?.addEventListener("click", () => modal.style.display = "none");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const payload = {
            groupe_sanguin: document.getElementById("sos-groupe").value,
            rhesus: document.getElementById("sos-rhesus").value,
            quantite_demandee: parseInt(document.getElementById("sos-quantite").value, 10),
            description: document.getElementById("sos-description").value
        };

        try {
            const res = await fetch('/api/sos/lancer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                showToast("Appel SOS diffusé à tout le réseau", "success");
                modal.style.display = "none";
                form.reset();
                await fetchActiveSos(token);
            } else {
                showToast(data.message || "Erreur lors du lancement du SOS", "error");
            }
        } catch (err) {
            console.error("Erreur lancement SOS :", err);
            showToast("Erreur de connexion au serveur", "error");
        }
    });
};

const fetchActiveSos = async (token) => {
    const container = document.getElementById("sos-active-list");
    if (!container) return;

    try {
        const res = await fetch('/api/sos/actifs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Erreur serveur");

        const sosList = await res.json();

        if (sosList.length === 0) {
            container.innerHTML = `<p style="color:#16a34a; font-size:0.85rem;"><i class="fa-solid fa-circle-check"></i> Aucun appel SOS actif sur le réseau.</p>`;
            return;
        }

        container.innerHTML = sosList.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px 14px;">
                <div>
                    <strong style="color:#dc2626;">${s.groupe_sanguin}${s.rhesus}</strong>
                    — ${s.quantite_demandee} poche(s) — <strong>${s.nom_hopital_demandeur}</strong>
                    <br><small style="color:#64748b;">${s.description || ''}</small>
                </div>
                <small style="color:#94a3b8; white-space:nowrap;">${new Date(s.date_creation).toLocaleString('fr-FR')}</small>
            </div>
        `).join('');
    } catch (err) {
        console.error("Erreur chargement SOS actifs :", err);
        container.innerHTML = `<p style="color:#dc2626; font-size:0.85rem;">Impossible de charger les appels SOS actifs.</p>`;
    }
};
