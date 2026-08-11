const cron = require('node-cron');
const db = require('../../config/db');
const predictionService = require('../services/predictionService');
const socketConfig = require('../../config/socket');

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

// Tâche planifiée : S'exécute TOUS LES JOURS À 00:15 (juste après le scan
// de péremption ci-dessus, pour que les prédictions se basent sur un stock
// à jour). Génère des alertes RUPTURE_PREVUE et SURPLUS_A_RISQUE à partir
// du module de prédiction, conformément à RF-15/RF-16/RF-17 et au
// couplage acté (Option A : persistance en base).
cron.schedule('15 0 * * *', async () => {
    console.log('[CRON] Début du calcul quotidien des prédictions de stock...');

    try {
        const hopitauxResult = await db.query(
            `SELECT id_hopital, nom FROM medical_logistics.hopitaux WHERE statut = 'ACTIF';`
        );

        let io;
        try {
            io = socketConfig.getIO();
        } catch (e) {
            io = null; // le serveur socket peut ne pas être initialisé dans certains contextes de test
        }

        let nbAlertesGenerees = 0;

        for (const hopital of hopitauxResult.rows) {
            const predictions = await predictionService.predireStockHopital(hopital.id_hopital);

            for (const pred of predictions) {
                let typeAlerte = null;
                let message = null;
                let joursEstimes = null;

                if (pred.statut === 'RUPTURE_IMMINENTE' && pred.jours_avant_rupture !== null) {
                    typeAlerte = 'RUPTURE_PREVUE';
                    joursEstimes = pred.jours_avant_rupture;
                    message = `Rupture de stock prévue pour le groupe ${pred.groupe_sanguin} dans environ ${pred.jours_avant_rupture} jour(s), au rythme de consommation actuel.`;
                } else if (pred.poches_a_risque.length > 0) {
                    typeAlerte = 'SURPLUS_A_RISQUE';
                    joursEstimes = Math.min(...pred.poches_a_risque.map(p => p.jours_restants));
                    message = `${pred.poches_a_risque.length} poche(s) de groupe ${pred.groupe_sanguin} risque(nt) d'être perdue(s) par péremption sous ${joursEstimes} jour(s). Un transfert vers un hôpital en besoin est recommandé.`;
                }

                if (!typeAlerte) continue;

                // Insertion idempotente : idx_alertes_unicite_jour empêche
                // les doublons si le cron est relancé le même jour.
                const insertResult = await db.query(
                    `INSERT INTO medical_logistics.alertes 
                        (id_hopital, type_alerte, groupe_sanguin, message, jours_estimes)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (id_hopital, type_alerte, groupe_sanguin, (date_creation::date)) DO NOTHING
                     RETURNING id_alerte;`,
                    [hopital.id_hopital, typeAlerte, pred.groupe_sanguin, message, joursEstimes]
                );

                if (insertResult.rows.length > 0) {
                    nbAlertesGenerees++;

                    if (io) {
                        io.to(`hospital_${hopital.id_hopital}`).emit('nouvelle_alerte', {
                            type: typeAlerte,
                            groupe_sanguin: pred.groupe_sanguin,
                            message,
                            jours_estimes: joursEstimes
                        });
                    }
                }
            }
        }

        console.log(`[CRON] Prédictions terminées : ${nbAlertesGenerees} nouvelle(s) alerte(s) générée(s).`);

    } catch (error) {
        console.error('[CRON] Erreur lors du calcul des prédictions :', error);
    }
});

module.exports = cron;