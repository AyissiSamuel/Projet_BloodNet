const cron = require('node-cron');
const db = require('../../config/db');

// Tâche planifiée : S'exécute TOUS LES JOURS À MINUIT (00:00)
cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Début du scan quotidien des poches de sang périmées...');

    try {
        const queryText = `
            UPDATE medical_logistics.poches_sang
            SET statut = 'PERIME'
            WHERE date_peremption <= NOW()
              AND statut IN ('DISPONIBLE', 'RESERVE')
            RETURNING id_poche, groupe_sanguin, id_hopital;
        `;

        const result = await db.query(queryText);
        const nbPochesPerimees = result.rows.length;

        if (nbPochesPerimees > 0) {
            console.log(`[CRON] Succès : ${nbPochesPerimees} poche(s) de sang marquée(s) comme PERIME.`);
            result.rows.forEach(poche => {
                console.log(`   - Poche ID ${poche.id_poche} (${poche.groupe_sanguin}) à l'hôpital ID ${poche.id_hopital} est périmée.`);
            });
        } else {
            console.log('[CRON] Aucune nouvelle poche périmée détectée aujourd\'hui. Stock sain !');
        }

    } catch (error) {
        console.error('[CRON] Erreur lors de la mise à jour des poches périmées :', error);
    }
});

module.exports = cron;