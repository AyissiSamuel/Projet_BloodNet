import { showToast } from './toast.js';

export const initAdminOrdersModule = async (token) => {
    setupArbitrageEvents(token);
    await fetchAdminOrders(token);
};

// --- 1. RÉCUPÉRATION DES COMMANDES À RÉGULER ---
const fetchAdminOrders = async (token) => {
    const tbody = document.getElementById("admin-orders-table-body");
    const historyBody = document.getElementById("admin-orders-history-body");

    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Chargement des réquisitions...</td></tr>`;

    try {
        const res = await fetch('/api/admin/commandes/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const data = await res.json(); 
        // data = { pending: [...], history: [...] }

        document.getElementById("pending-orders-count").textContent = data.pending?.length || 0;

        renderPendingTable(data.pending || [], token);
        renderHistoryTable(data.history || []);

    } catch (err) {
        console.error("Erreur commandes admin:", err);
        showToast("Impossible de charger les réquisitions", "error");
    }
};

// --- 2. RENDU DE LA FILE D'ATTENTE ---
const renderPendingTable = (orders, token) => {
    const tbody = document.getElementById("admin-orders-table-body");
    tbody.innerHTML = "";

    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Aucune demande en attente de régulation.</td></tr>`;
        return;
    }

    orders.forEach(ord => {
        const tr = document.createElement("tr");

        // NOTE : medical_logistics.commandes n'a pas de colonne "urgence" —
        // ce badge affichait toujours "Normale" quel que soit le contexte
        // réel. Retiré en attendant une éventuelle évolution du schéma pour
        // distinguer une commande née d'un SOS (cf. sos_urgences) d'une
        // commande directe classique.
        tr.innerHTML = `
            <td><strong>#${ord.id_commande}</strong></td>
            <td>${ord.hopital_demandeur}</td>
            <td>${ord.hopital_fournisseur}</td>
            <td><strong>${ord.quantite_poches}</strong> poche(s) (${ord.groupe_sanguin_complet})</td>
            <td>${new Date(ord.date_commande).toLocaleString('fr-FR')}</td>
            <td>
                <button class="btn-sm btn-primary btn-open-arbitrage" 
                    data-id="${ord.id_commande}" 
                    data-demandeur="${ord.hopital_demandeur}"
                    data-fournisseur="${ord.hopital_fournisseur}"
                    data-quantite="${ord.quantite_poches}"
                    data-groupe="${ord.groupe_sanguin_complet}">
                    <i class="fa-solid fa-gavel"></i> Statuer
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Écouteur ouverture modale
    document.querySelectorAll(".btn-open-arbitrage").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const ds = e.currentTarget.dataset;
            openArbitrageModal(ds, token);
        });
    });
};

// --- 3. RENDU HISTORIQUE DÉCISIONS ---
const renderHistoryTable = (history) => {
    const tbody = document.getElementById("admin-orders-history-body");
    tbody.innerHTML = "";

    if (history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Aucun historique récent.</td></tr>`;
        return;
    }

    history.forEach(h => {
        const tr = document.createElement("tr");
        // Statuts réels de medical_logistics.commandes.statut :
        // EN_ATTENTE, ACCEPTEE, REFUSEE, EXPEDIEE, LIVREE, ANNULEE
        const isApproved = h.statut === 'ACCEPTEE' || h.statut === 'EXPEDIEE' || h.statut === 'LIVREE';

        tr.innerHTML = `
            <td><strong>#${h.id_commande}</strong></td>
            <td>${h.hopital_demandeur} ➔ ${h.hopital_fournisseur}</td>
            <td>${h.quantite_poches} poche(s) (${h.groupe_sanguin_complet})</td>
            <td><span class="badge ${isApproved ? 'status-ok' : 'status-critique'}">${h.statut}</span></td>
            <td>${h.drone_assigne || '—'}</td>
            <td>${new Date(h.date_commande).toLocaleString('fr-FR')}</td>
        `;
        tbody.appendChild(tr);
    });
};

// --- 4. GESTION DU FORMULAIRE ET DÉCISIONS ---
const openArbitrageModal = (data, token) => {
    document.getElementById("arbitrage-order-id").textContent = `#${data.id}`;
    document.getElementById("arb-commande-id").value = data.id;
    document.getElementById("arb-demandeur").textContent = data.demandeur;
    document.getElementById("arb-fournisseur").textContent = data.fournisseur;
    document.getElementById("arb-quantite").textContent = data.quantite;
    document.getElementById("arb-groupe").textContent = data.groupe;

    document.getElementById("modal-arbitrage-order").style.display = "flex";
};

const setupArbitrageEvents = (token) => {
    const modal = document.getElementById("modal-arbitrage-order");
    document.getElementById("close-arbitrage-modal")?.addEventListener("click", () => modal.style.display = "none");

    // Valider la commande
    document.getElementById("form-arbitrage")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await sendDecision('ACCEPTEE', token);
    });

    // Rejeter la commande
    document.getElementById("btn-reject-order")?.addEventListener("click", async () => {
        if (confirm("Êtes-vous sûr de vouloir rejeter cette réquisition ?")) {
            await sendDecision('REFUSEE', token);
        }
    });
};

const sendDecision = async (statut, token) => {
    // NOTE : drone_id et note sont envoyés mais ne sont actuellement pas
    // persistés côté backend (aucune colonne correspondante dans
    // medical_logistics.commandes) — conservés ici pour une évolution future.
    const payload = {
        id_commande: document.getElementById("arb-commande-id").value,
        statut_decision: statut,
        drone_id: document.getElementById("arb-drone-assign").value,
        note: document.getElementById("arb-note").value
    };

    try {
        const res = await fetch('/api/admin/commandes/arbitrer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast(`Commande ${statut === 'ACCEPTEE' ? 'approuvée avec succès' : 'rejetée'}`, "success");
            document.getElementById("modal-arbitrage-order").style.display = "none";
            fetchAdminOrders(token);
        } else {
            showToast("Erreur lors de l'enregistrement de la décision", "error");
        }
    } catch (err) {
        showToast("Erreur serveur", "error");
    }
};