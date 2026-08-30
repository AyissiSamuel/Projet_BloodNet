1| // src/controllers/donneurController.js
2| const db = require('../../config/db');
3| const smsService = require('../services/smsService');
4| 
5| // Durée de conservation par défaut pour une poche issue d'un don (sang total).
6| // Alignée sur la logique déjà appliquée dans pochesController.js.
7| const DUREE_CONSERVATION_JOURS = 42;
8| 
9| // 1. Enregistrer un nouveau donneur (étape indépendante, conservée pour
10| // les cas où le personnel veut créer une fiche donneur sans don immédiat).
11| exports.registerDonneur = async (req, res) => {
12|     const { nom, telephone, email, groupe_sanguin, date_dernier_don, est_anonyme } = req.body;
13| 
14|     // Un donneur anonyme peut ne pas fournir son nom : on utilise un nom
15|     // générique dans ce cas plutôt que de bloquer l'enregistrement.
16|     const nomFinal = est_anonyme ? (nom || 'Donneur anonyme') : nom;
17| 
18|     if (!est_anonyme && !nom) {
19|         return res.status(400).json({ message: "Le nom est requis pour un donneur non anonyme." });
20|     }
21|     if (!telephone || !groupe_sanguin) {
22|         return res.status(400).json({ message: "Le téléphone et le groupe sanguin sont requis." });
23|     }
24| 
25|     try {
26|         const queryText = `
27|             INSERT INTO medical_logistics.donneurs (nom, telephone, email, groupe_sanguin, date_dernier_don, est_anonyme)
28|             VALUES ($1, $2, $3, $4, $5, $6)
29|             RETURNING *;
30|         `;
31| 
32|         const values = [
33|             nom,
34|             telephone,
35|             email || null,
36|             groupe_sanguin.toUpperCase(),
37|             date_dernier_don || null,
38|             est_anonyme || false
39|         ];
40|         const result = await db.query(queryText, values);
41| 
42|         res.status(201).json({
43|             message: "Donneur enregistré avec succès.",
44|             donneur: result.rows[0]
45|         });
46|     } catch (error) {
47|         console.error("Erreur Enregistrement Donneur :", error);
48| 
49|         if (error.code === '23505') {
50|             return res.status(400).json({ message: "Un donneur avec ce numéro de téléphone ou cet email existe déjà." });
51|         }
52|         if (error.code === '23514' && error.constraint === 'chk_donneur_groupe') {
53|             return res.status(400).json({ message: "Groupe sanguin invalide. Valeurs autorisées : A+, A-, B+, B-, AB+, AB-, O+, O-." });
54|         }
55| 
56|         res.status(500).json({ message: "Erreur lors de l'enregistrement du donneur." });
57|     }
58| };
59| 
60| // 2. Rechercher des donneurs éligibles par groupe sanguin (Urgence)
61| exports.searchDonneurs = async (req, res) => {
62|     const { groupe_sanguin } = req.query;
63| 
64|     try {
65|         let queryText = `
66|             SELECT id_donneur, nom, telephone, email, groupe_sanguin, date_dernier_don, est_anonyme 
67|             FROM medical_logistics.donneurs WHERE statut_eligibilite = true
68|         `;
69|         const params = [];
70| 
71|         if (groupe_sanguin) {
72|             params.push(groupe_sanguin.toUpperCase());
73|             queryText += ` AND groupe_sanguin = $1`;
74|         }
75| 
76|         const result = await db.query(queryText, params);
77|         res.status(200).json(result.rows);
78|     } catch (error) {
79|         console.error("Erreur Recherche Donneurs :", error);
80|         res.status(500).json({ message: "Impossible de rechercher les donneurs." });
81|     }
82| };
83| 
84| // 3. Liste des donneurs AYANT DÉJÀ DONNÉ DANS L'HÔPITAL CONNECTÉ (attendue
85| // par le frontend : GET /api/donneurs)
86| //
87| // CORRECTIF : cette liste était auparavant globale (tous les donneurs de
88| // toutes les structures, sans filtre), car la table medical_logistics.donneurs
89| // n'a pas de colonne id_hopital — un donneur est une entité indépendante,
90| // seul son historique de dons (historique_dons.id_hopital_prelevement) est
91| // rattaché à un établissement précis. On restreint donc désormais la liste
92| // aux donneurs ayant au moins un don enregistré dans l'hôpital connecté
93| // (INNER JOIN sur historique_dons filtré par hôpital), et les compteurs
94| // total_dons / dernier_don ne portent eux aussi que sur cet hôpital — pas
95| // sur l'activité globale du donneur dans tout le réseau.
96| exports.getAllDonneurs = async (req, res) => {
97|     const id_hopital = req.user.id_hopital;
98| 
99|     if (!id_hopital) {
100|         // Compte sans hôpital rattaché (ex. SUPER_ADMIN) : cette vue n'a pas
101|         // de sens à l'échelle réseau ici, on renvoie une liste vide plutôt
102|         // qu'un mélange de tous les hôpitaux.
103|         return res.status(200).json([]);
104|     }
105| 
106|     try {
107|         const result = await db.query(
108|             `SELECT 
109|                 d.id_donneur,
110|                 CONCAT('DON-', UPPER(SUBSTRING(d.id_donneur::text, 1, 6))) AS code_donneur,
111|                 d.nom AS nom_complet,
112|                 d.telephone,
113|                 d.email,
114|                 d.groupe_sanguin,
115|                 d.est_anonyme,
116|                 d.statut_eligibilite,
117|                 COUNT(h.id_don) AS total_dons,
118|                 MAX(h.date_don) AS dernier_don
119|              FROM medical_logistics.donneurs d
120|              INNER JOIN medical_logistics.historique_dons h 
121|                 ON h.id_donneur = d.id_donneur AND h.id_hopital_prelevement = $1
122|              GROUP BY d.id_donneur, d.nom, d.telephone, d.email, d.groupe_sanguin, d.est_anonyme, d.statut_eligibilite
123|              ORDER BY dernier_don DESC NULLS LAST;`,
124|             [id_hopital]
125|         );
126|         res.status(200).json(result.rows);
127|     } catch (error) {
128|         console.error("Erreur récupération liste donneurs :", error);
129|         res.status(500).json({ message: "Impossible de récupérer la liste des donneurs." });
130|     }
131| };
132| 
133| // 4. ENREGISTRER UN DONNEUR ET SON DON EN UNE SEULE REQUÊTE
134| //
135| // Fusion des anciennes étapes registerDonneur + registrarDon, conformément
136| // au flux attendu par le frontend (public/js/modules/donors.js), qui
137| // soumet un formulaire unique "nouveau don" plutôt que deux formulaires
138| // séparés. Gère aussi l'option "don anonyme".
139| //
140| // Le don se traduit par la création d'une POCHE INDIVIDUELLE dans
141| // medical_logistics.poches_sang (gestion poche par poche actée), et non
142| // plus par l'incrémentation d'un compteur agrégé dans une table "stocks"
143| // séparée — ce qui supprimait la double source de vérité identifiée en
144| // phase d'analyse.
145| exports.enregistrerDonEtDonneur = async (req, res) => {
146|     const {
147|         id_donneur,       // optionnel : si fourni, réutilise un donneur existant
148|         nom_complet,
149|         telephone,
150|         email,
151|         groupe_sanguin,
152|         est_anonyme,
153|         volume_ml,
154|         remarques
155|     } = req.body;
156| 
157|     const id_hopital = req.user.id_hopital;
158| 
159|     if (!groupe_sanguin) {
160|         return res.status(400).json({ message: "Le groupe sanguin est requis." });
161|     }
162|     if (!est_anonyme && !id_donneur && !nom_complet) {
163|         return res.status(400).json({ message: "Le nom du donneur est requis (sauf don anonyme)." });
164|     }
165| 
166|     const client = await db.connect();
167|     try {
168|         await client.query('BEGIN');
169| 
170|         let donneurId = id_donneur;
171| 
172|         // Si aucun donneur existant n'est référencé, on en crée un nouveau
173|         if (!donneurId) {
174|             const nomFinal = est_anonyme ? (nom_complet || 'Donneur anonyme') : nom_complet;
175|             // donneurs.telephone est NOT NULL et UNIQUE en base (contraintes
176|             // réelles du schéma) : un don anonyme sans téléphone fourni
177|             // utilise un identifiant généré unique plutôt qu'une valeur
178|             // littérale fixe, qui violerait l'unicité dès le 2e don anonyme.
179|             const telephoneFinal = telephone || (est_anonyme ? `ANONYME-${Date.now()}` : null);
180|             if (!telephoneFinal) {
181|                 await client.query('ROLLBACK');
182|                 return res.status(400).json({ message: "Le téléphone est requis (sauf don anonyme)." });
183|             }
184|             const donneurInsert = await client.query(
185|                 `INSERT INTO medical_logistics.donneurs (nom, telephone, email, groupe_sanguin, est_anonyme)
186|                  VALUES ($1, $2, $3, $4, $5)
187|                  RETURNING id_donneur`,
188|                 [nomFinal, telephoneFinal, email || null, groupe_sanguin.toUpperCase(), est_anonyme || false]
189|             );
190|             donneurId = donneurInsert.rows[0].id_donneur;
191|         } else {
192|             // Vérification d'éligibilité : 8 semaines (56 jours) depuis le dernier don
193|             const dernierDonCheck = await client.query(
194|                 `SELECT date_don FROM medical_logistics.historique_dons 
195|                  WHERE id_donneur = $1 ORDER BY date_don DESC LIMIT 1`,
196|                 [donneurId]
197|             );
198| 
199|             if (dernierDonCheck.rows.length > 0) {
200|                 const joursDepuisDernierDon = Math.floor(
201|                     (Date.now() - new Date(dernierDonCheck.rows[0].date_don).getTime()) / (1000 * 3600 * 24)
202|                 );
203|                 if (joursDepuisDernierDon < 56) {
204|                     await client.query('ROLLBACK');
205|                     return res.status(400).json({
206|                         message: `Ce donneur n'est pas encore éligible (dernier don il y a ${joursDepuisDernierDon} jours, minimum 56 jours).`,
207|                         jours_restants: 56 - joursDepuisDernierDon
208|                     });
209|                 }
210|             }
211|         }
212| 
213|         // Enregistrer le don dans l'historique
214|         const nouveauDon = await client.query(
215|             `INSERT INTO medical_logistics.historique_dons (id_donneur, id_hopital_prelevement, volume_ml, remarques)
216|              VALUES ($1, $2, $3, $4) RETURNING *`,
217|             [donneurId, id_hopital, volume_ml || 450, remarques || null]
218|         );
219| 
220|         // Créer la poche individuelle correspondante (gestion poche par poche)
221|         const datePeremption = new Date();
222|         datePeremption.setDate(datePeremption.getDate() + DUREE_CONSERVATION_JOURS);
223| 
224|         const nouvellePoche = await client.query(
225|             `INSERT INTO medical_logistics.poches_sang 
226|                 (id_hopital, groupe_sanguin, composant, volume_ml, date_collecte, date_peremption, statut)
227|              VALUES ($1, $2, 'SANG_TOTAL', $3, CURRENT_DATE, $4, 'DISPONIBLE')
228|              RETURNING *`,
229|             [id_hopital, groupe_sanguin.toUpperCase(), volume_ml || 450, datePeremption]
230|         );
231| 
232|         await client.query('COMMIT');
233| 
234|         res.status(201).json({
235|             message: "Don enregistré avec succès. Une nouvelle poche a été ajoutée au stock.",
236|             don: nouveauDon.rows[0],
237|             poche: nouvellePoche.rows[0]
238|         });
239| 
240|     } catch (error) {
241|         await client.query('ROLLBACK');
242|         console.error("Erreur enregistrement don :", error);
243|         res.status(500).json({ message: "Erreur interne lors de la validation du don." });
244|     } finally {
245|         client.release();
246|     }
247| };
248| 
249| // 5. Historique d'un donneur précis
250| exports.getHistoriqueDonneur = async (req, res) => {
251|     const { id_donneur } = req.params;
252| 
253|     try {
254|         const result = await db.query(
255|             `SELECT h.*, hop.nom as nom_hopital 
256|              FROM medical_logistics.historique_dons h
257|              JOIN medical_logistics.hopitaux hop ON h.id_hopital_prelevement = hop.id_hopital
258|              WHERE h.id_donneur = $1
259|              ORDER BY h.date_don DESC`,
260|             [id_donneur]
261|         );
262| 
263|         res.status(200).json(result.rows);
264|     } catch (error) {
265|         console.error("Erreur récupération historique :", error);
266|         res.status(500).json({ message: "Impossible de récupérer l'historique du donneur." });
267|     }
268| };
269| 
270| // 6. Historique des dons DE L'HÔPITAL CONNECTÉ (attendu par le frontend :
271| // GET /api/donneurs/historique-dons)
272| //
273| // CORRECTIF : renvoyait auparavant l'historique de TOUS les hôpitaux
274| // confondus (aucun filtre). Restreint désormais à id_hopital_prelevement =
275| // hôpital connecté, cohérent avec getAllDonneurs ci-dessus.
276| exports.getHistoriqueGlobal = async (req, res) => {
277|     const id_hopital = req.user.id_hopital;
278| 
279|     if (!id_hopital) {
280|         return res.status(200).json([]);
281|     }
282| 
283|     try {
284|         const result = await db.query(
285|             `SELECT 
286|                 h.id_don,
287|                 h.date_don,
288|                 h.volume_ml,
289|                 h.remarques,
290|                 CONCAT('DON-', UPPER(SUBSTRING(d.id_donneur::text, 1, 6))) AS code_donneur,
291|                 d.nom AS nom_donneur,
292|                 d.est_anonyme,
293|                 d.groupe_sanguin,
294|                 hop.nom AS lieu_prelevement
295|              FROM medical_logistics.historique_dons h
296|              JOIN medical_logistics.donneurs d ON h.id_donneur = d.id_donneur
297|              JOIN medical_logistics.hopitaux hop ON h.id_hopital_prelevement = hop.id_hopital
298|              WHERE h.id_hopital_prelevement = $1
299|              ORDER BY h.date_don DESC
300|              LIMIT 100;`,
301|             [id_hopital]
302|         );
303|         res.status(200).json(result.rows);
304|     } catch (error) {
305|         console.error("Erreur récupération historique donneurs :", error);
306|         res.status(500).json({ message: "Impossible de récupérer l'historique des dons." });
307|     }
308| };
309| 
310| // 7. Envoi de SMS à un donneur (action réservée aux ADMIN_HOPITAL)
311| exports.sendSmsToDonor = async (req, res) => {
312|     const donorId = req.params.id;
313|     const { message } = req.body || {};
314| 
315|     // Autorisation : seul le rôle ADMIN_HOPITAL peut envoyer des SMS via la plateforme
316|     if (!req.user || req.user.role !== 'ADMIN_HOPITAL') {
317|         return res.status(403).json({ message: 'Accès non autorisé.' });
318|     }
319| 
320|     if (!message || message.trim().length === 0) {
321|         return res.status(400).json({ message: 'Le message est requis.' });
322|     }
323| 
324|     try {
325|         const result = await db.query('SELECT telephone, nom FROM medical_logistics.donneurs WHERE id_donneur = $1', [donorId]);
326|         if (result.rows.length === 0) {
327|             return res.status(404).json({ message: 'Donneur introuvable.' });
328|         }
329| 
330|         const { telephone, nom } = result.rows[0];
331|         if (!telephone || telephone.startsWith('ANONYME')) {
332|             return res.status(400).json({ message: 'Numéro de téléphone indisponible pour ce donneur.' });
333|         }
334| 
335|         const sendResult = await smsService.sendSMS(telephone, message);
336|         if (sendResult.success) {
337|             return res.status(200).json({ message: 'SMS envoyé avec succès.' });
338|         } else {
339|             console.error('Erreur envoi SMS:', sendResult.error);
340|             return res.status(500).json({ message: sendResult.error || 'Erreur lors de l\'envoi du SMS.' });
341|         }
342|     } catch (err) {
343|         console.error('Erreur sendSmsToDonor:', err);
344|         return res.status(500).json({ message: 'Erreur serveur lors de l\'envoi du SMS.' });
345|     }
346| };
