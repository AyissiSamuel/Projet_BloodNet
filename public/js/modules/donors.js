import { showToast } from './toast.js';

export const initDonorsModule = async (token) => {
    setupDonorEvents(token);
    await fetchDonorsList(token);
    await fetchDonationsHistory(token);
};

// --- 1. RECUPÉRATION DU REGISTRE DES DONNEURS ---
const fetchDonorsList = async (token) => {
    const tbody = document.getElementById("donors-table-body");
    if (!tbody) return;

    try {
        const res = await fetch('/api/donneurs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const donors = await res.json();
        renderDonorsTable(donors);
    } catch (err) {
        console.error("Erreur donneurs:", err);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Impossible de charger la liste des donneurs.</td></tr>`;
    }
};

const renderDonorsTable = (donors) => {
    const tbody = document.getElementById("donors-table-body");
    tbody.innerHTML = "";

    if (!donors || donors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Aucun donneur enregistré.</td></tr>`;
        return;
    }

    donors.forEach(donor => {
        const isAnon = donor.est_anonyme;
        const nameDisplay = isAnon ? `<em style="color:#64748b;">Donneur Anonyme</em>` : `<strong>${donor.nom_complet}</strong>`;

        // AJOUT (audit) : calcul d'éligibilité au rappel — un donneur de
        // sang total doit respecter un délai minimal (~90 jours) avant de
        // pouvoir redonner. Permet de cibler qui contacter en priorité.
        const joursDepuisDernierDon = donor.dernier_don
            ? Math.floor((Date.now() - new Date(donor.dernier_don).getTime()) / 86400000)
            : null;
        const estEligible = joursDepuisDernierDon === null || joursDepuisDernierDon >= 90;

        const badgeEligibilite = estEligible
            ? `<span class="badge" style="background:#dcfce7; color:#16a34a;">Éligible</span>`
            : `<span class="badge" style="background:#fef3c7; color:#b45309;">Dans ${90 - joursDepuisDernierDon} j</span>`;

        // Bouton "Contacter" : n'apparaît que si on a un numéro (pas
        // anonyme) — ouvre l'application SMS du téléphone avec un message
        // pré-rempli invitant au rappel. Voir explication complète (SMS
        // groupés / Firebase) dans le rapport d'audit fourni séparément.
        const boutonContact = (!isAnon && donor.telephone)
            ? `<button class="btn-sm btn-secondary btn-contact-donor" data-tel="${donor.telephone}" data-nom="${donor.nom_complet}" title="Contacter par SMS">
                   <i class="fa-solid fa-comment-sms"></i>
               </button>`
            : '';

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><code>${donor.code_donneur}</code></td>
            <td>${nameDisplay}</td>
            <td><strong>${donor.groupe_sanguin}</strong></td>
            <td>${isAnon ? 'N/A' : (donor.telephone || 'Non renseigné')}</td>
            <td>${donor.total_dons || 1} don(s)</td>
            <td>${donor.dernier_don ? new Date(donor.dernier_don).toLocaleDateString('fr-FR') : '-'}</td>
            <td>${badgeEligibilite}</td>
            <td style="white-space:nowrap;">
                <button class="btn-sm btn-secondary btn-new-donation" data-id="${donor.id_donneur}" data-group="${donor.groupe_sanguin}">
                    <i class="fa-solid fa-plus"></i> Don
                </button>
                ${boutonContact}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // "Contacter" : ouvre l'app SMS native du poste avec un message
    // pré-rempli. Simple, fonctionne sans aucune configuration ni service
    // tiers — pertinent pour un projet académique. Pour un envoi groupé
    // automatisé en production, voir le rapport d'audit (comparatif
    // Firebase Cloud Messaging / passerelle SMS).
    document.querySelectorAll(".btn-contact-donor").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const { tel, nom } = e.currentTarget.dataset;
            const message = encodeURIComponent(
                `Bonjour ${nom}, votre dernier don de sang remonte à un moment déjà — seriez-vous disponible pour un nouveau don prochainement ? Merci de votre engagement. — BloodNet`
            );
            window.open(`sms:${tel}?body=${message}`, '_blank');
        });
    });

    // Écouteur pour "Nouveau Don" sur un donneur déjà enregistré : pré-remplit
    // la modale avec l'id_donneur existant, pour que enregistrerDonEtDonneur
    // (backend) réutilise la fiche au lieu d'en créer une nouvelle.
    document.querySelectorAll(".btn-new-donation").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const { id, group } = e.currentTarget.dataset;
            const modal = document.getElementById("modal-add-donor");
            const form = document.getElementById("form-add-donor");

            form.dataset.existingDonorId = id; // consommé à la soumission du formulaire
            document.getElementById("donor-blood-group").value = group;

            // Le donneur existe déjà : les champs identité ne sont pas requis à nouveau
            document.getElementById("donor-personal-info").style.display = "none";
            document.getElementById("donor-nom").removeAttribute("required");

            modal.style.display = "flex";
        });
    });
};

// --- 2. HISTORIQUE GLOBAL DES DONS ---
const fetchDonationsHistory = async (token) => {
    const tbody = document.getElementById("donations-history-table-body");
    if (!tbody) return;

    try {
        const res = await fetch('/api/donneurs/historique-dons', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) return;

        const history = await res.json();
        tbody.innerHTML = "";

        if (history.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Aucun prélèvement enregistré.</td></tr>`;
            return;
        }

        history.forEach(item => {
            const tr = document.createElement("tr");
            // NOTE : aucune colonne de statut sérologique n'existe dans le
            // schéma réel (historique_dons n'a pas ce champ) — affiché comme
            // information non disponible plutôt qu'une fausse conformité.
            tr.innerHTML = `
                <td>${new Date(item.date_don).toLocaleString('fr-FR')}</td>
                <td><code>${item.code_donneur}</code></td>
                <td><strong>${item.groupe_sanguin}</strong></td>
                <td>${item.volume_ml} mL</td>
                <td>${item.lieu_prelevement}</td>
                <td><span class="badge" style="background:#f1f5f9; color:#475569;">Non renseigné</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Erreur historique dons:", err);
    }
};

// --- 3. ÉVÉNEMENTS DU MODULE ET MASQUAGE ANONYMAT ---
const setupDonorEvents = (token) => {
    const modal = document.getElementById("modal-add-donor");
    const anonCheckbox = document.getElementById("donor-is-anonymous");
    const personalInfoDiv = document.getElementById("donor-personal-info");

    document.getElementById("btn-open-donor-modal")?.addEventListener("click", () => modal.style.display = "flex");
    document.getElementById("close-donor-modal")?.addEventListener("click", () => modal.style.display = "none");
    document.getElementById("cancel-donor-modal")?.addEventListener("click", () => modal.style.display = "none");

    // Masquer les champs "Nom" et "Téléphone" si anonyme
    anonCheckbox?.addEventListener("change", (e) => {
        if (e.target.checked) {
            personalInfoDiv.style.display = "none";
            document.getElementById("donor-nom").removeAttribute("required");
        } else {
            personalInfoDiv.style.display = "block";
            document.getElementById("donor-nom").setAttribute("required", "true");
        }
    });

    // Soumission du formulaire
    document.getElementById("form-add-donor")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const isAnon = anonCheckbox.checked;
        const form = e.currentTarget;
        const existingDonorId = form.dataset.existingDonorId || null;

        const payload = {
            id_donneur: existingDonorId,
            est_anonyme: isAnon,
            nom_complet: isAnon ? null : document.getElementById("donor-nom").value,
            telephone: isAnon ? null : document.getElementById("donor-phone").value,
            groupe_sanguin: document.getElementById("donor-blood-group").value,
            volume_ml: parseInt(document.getElementById("donor-volume").value, 10)
        };

        try {
            const res = await fetch('/api/donneurs/enregistrer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast("Donneur et don enregistrés avec succès", "success");
                modal.style.display = "none";
                delete form.dataset.existingDonorId; // réinitialise pour le prochain ajout "classique"
                personalInfoDiv.style.display = "block";
                initDonorsModule(token);
            } else {
                showToast("Erreur lors de l'enregistrement", "error");
            }
        } catch (err) {
            showToast("Erreur serveur", "error");
        }
    });
};