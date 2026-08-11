import { showToast } from './toast.js';

export const initAdminCarteModule = async (token) => {
    // Coordonnées de Yaoundé par défaut, cohérentes avec le reste du projet
    const map = L.map('admin-network-map').setView([3.8480, 11.5021], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    try {
        const res = await fetch('/api/admin/carte-reseau', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Erreur serveur");

        const hopitaux = await res.json();

        if (hopitaux.length === 0) {
            showToast("Aucun établissement géolocalisé trouvé", "error");
            return;
        }

        const bounds = [];

        hopitaux.forEach(h => {
            const lat = parseFloat(h.latitude);
            const lng = parseFloat(h.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            const couleur = h.statut === 'ACTIF' ? '#16a34a' : h.statut === 'EN_ATTENTE' ? '#d97706' : '#dc2626';

            const icone = L.divIcon({
                className: '',
                html: `<div style="background:${couleur}; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>`,
                iconSize: [16, 16]
            });

            const marker = L.marker([lat, lng], { icon: icone }).addTo(map);

            marker.bindPopup(`
                <strong>${h.name}</strong><br>
                <span style="color:#64748b;">${h.region || 'Région non renseignée'}</span><br>
                <span style="color:${couleur}; font-weight:600;">${h.statut}</span><br>
                <hr style="margin:6px 0;">
                <strong>Stock disponible :</strong> ${h.total_stock} poche(s)<br>
                <small>${h.stock_summary}</small><br>
                <small>${h.phone || ''}</small>
            `);

            bounds.push([lat, lng]);
        });

        if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [40, 40] });
        }

    } catch (err) {
        console.error(err);
        showToast("Impossible de charger la carte du réseau", "error");
    }
};
