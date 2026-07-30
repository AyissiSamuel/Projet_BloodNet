const db = require('../../config/db');

// 1. ENREGISTRER UNE NOUVELLE POCHE DE SANG (DON / PRÉLÈVEMENT)
exports.enregistrerPoche = async (req, res) => {
    const { id_donneur, groupe_sanguin, composant, volume_ml, date_collecte } = req.body;
    const id_hopital = req.user.id_hopital;

    if (!groupe_sanguin || !composant || !volume_ml || !date_collecte) {
        return res.status(400).json({ 
            message: "Le groupe sanguin, le composant, le volume et la date de collecte sont requis." 
        });
    }

    try {
        // --- CALCUL DE LA DATE DE PÉREMPTION ---
        const dateDebut = new Date(date_collecte);
        let joursConservation = 42; 

        const comp = composant.toUpperCase();
        if (comp.includes("PLAQUETTE")) {
            joursConservation = 5;
        } else if (comp.includes("PLASMA")) {
            joursConservation = 365;
        } else if (comp.includes("CGR") || comp.includes("SANG_TOTAL")) {
            joursConservation = 42;
        }

        // Ajout des jours à la date de collecte
        const datePeremption = new Date(dateDebut);
        datePeremption.setDate(datePeremption.getDate() + joursConservation);

        // --- INSERTION EN BASE DE DONNÉES ---
        const queryText = `
            INSERT INTO medical_logistics.poches_sang 
            (id_hopital, id_donneur, groupe_sanguin, composant, volume_ml, date_collecte, date_peremption, statut)
            VALUES ($1, $2, UPPER($3), UPPER($4), $5, $6, $7, 'DISPONIBLE')
            RETURNING *;
        `;

        const values = [
            id_hopital,
            id_donneur || null, // Le donneur peut être anonyme ou non renseigné à cette étape
            groupe_sanguin,
            composant,
            volume_ml,
            date_collecte,
            datePeremption
        ];

        const result = await db.query(queryText, values);
        const nouvellePoche = result.rows[0];

        res.status(201).json({
            message: `Poche enregistrée avec succès. Durée de conservation : ${joursConservation} jours.`,
            poche: nouvellePoche
        });

    } catch (error) {
        console.error("Erreur lors de l'enregistrement de la poche :", error);
        res.status(500).json({ message: "Erreur lors de l'enregistrement de la poche de sang." });
    }
};

// 2. OBTENIR LE STOCK ACTUEL DE L'HÔPITAL (Filtré pour exclure le périmé)
exports.getStockInterne = async (req, res) => {
    const id_hopital = req.user.id_hopital;

    try {
        const queryText = `
            SELECT groupe_sanguin, composant, COUNT(*) as quantite_disponible
            FROM medical_logistics.poches_sang
            WHERE id_hopital = $1 
              AND statut = 'DISPONIBLE' 
              AND date_peremption > NOW() -- Filtre de sécurité temporel
            GROUP BY groupe_sanguin, composant
            ORDER BY groupe_sanguin, composant;
        `;
        const result = await db.query(queryText, [id_hopital]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erreur de récupération du stock unitaire :", error);
        res.status(500).json({ message: "Erreur de chargement du stock." });
    }
};