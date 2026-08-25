const cron = require('node-cron');
const db = require('../../config/db');
const predictionService = require('../services/predictionService');
const socketConfig = require('../../config/socket');
const { sendSMSViaAndroid } = require('../services/smsService'); // Assurez-vous d'avoir créé ce service

// Tâche planifiée 1 : Scan des poches périmées (TOUS LES JOURS À MINUIT)
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

// Tâche planifiée 2 : Prédictions de stock & alertes (TOUS LES JOURS À 00:15)
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
            io = null;
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

// Tâche planifiée 3 : Relance SMS des donneurs éligibles (TOUS LES JOURS À 09:00)
cron.schedule('0 9 * * *', async () => {
    console.log('[CRON] Début de la vérification des donneurs éligibles pour relance SMS...');

    try {
        const queryText = `
            SELECT id_donneur, nom, telephone 
            FROM medical_logistics.donneurs
            WHERE statut_eligibilite = true 
              AND date_dernier_don <= NOW() - INTERVAL '90 days'
              AND (date_derniere_relance IS NULL OR date_derniere_relance <= NOW() - INTERVAL '30 days');
        `;

        const result = await db.query(queryText);
        const donneurs = result.rows;

        if (donneurs.length > 0) {
            console.log(`[CRON] ${donneurs.length} donneur(s) éligible(s) trouvé(s) pour une relance.`);

            for (const donneur of donneurs) {
                const message = `Bonjour ${donneur.nom}, votre dernier don date de plus de 3 mois. Vous pouvez de nouveau donner votre sang et sauver des vies avec BloodNet !`;
                
                await sendSMSViaAndroid(donneur.telephone, message);

                // Marquer la date de dernière relance pour éviter le spam quotidien
                await db.query(
                    `UPDATE medical_logistics.donneurs SET date_derniere_relance = NOW() WHERE id_donneur = $1`,
                    [donneur.id_donneur]
                );

                // Pause de 2 secondes entre deux envois pour respecter le débit de la SIM
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            console.log('[CRON] Relance SMS terminée avec succès.');
        } else {
            console.log('[CRON] Aucun donneur à relancer aujourd\'hui.');
        }

    } catch (error) {
        console.error('[CRON] Erreur lors de la relance SMS des donneurs :', error);
    }
});

module.exports = cron;