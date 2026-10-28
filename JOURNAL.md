# LEGAL OS — Journal (décisions et preuves)

Synthèse au 28/10/2026 (archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`, `phase-3-avant-j11.md`, `docs/journal/j11.md`). Les hashs et les CI de chaque jalon sont dans `PLAN.md`.

- **Validés** : phases 0 et 1, J2 à J11, Migration Sync Streams, Référence de dossier, Conflits généralisés, Coque de l'app, Vue scindée, Intercalaires, Dossiers et contacts, Agenda, Documents suite, Bascule vers Claude Code, Montée PowerSync (`cbd4e4c`), Coque claire (`b53fd0f`).
- **J11** : VALIDÉ `1ebfac5` (contrôleur [série 0.5.3](f7264e1e-6b4b-4eb7-8c5f-813f260ff3f0), CI [40590037375](https://github.com/navelremi-boop/legalos2/actions/runs/40590037375)). Série du 28/10, une commande, poste construit liant `powersync` 0.1.1 et `powersync_core` 0.5.3 : dix passes vertes, deux `0xC0000374` non comptés (clichés `legal-os-poste-28476` et `legal-os-poste-10432`). Le détail est dans `docs/journal/j11.md`.
- **En cours : Finition des écrans** (après J11, critères validés par l'architecte le 07/10/2026).
- **Consigne du 28/10/2026 (crash natif, version allégée).** `tauri-plugin-wdio-webdriver` 1.5.1 (crates.io, MIT, `webview2-com` 0.39) remplace la copie de `patches/` : `cargo check --manifest-path apps/poste/src-tauri/Cargo.toml --features test-webdriver --target-dir target` exit 0 en 51 s. Les recettes Tauri lancent le poste avec `RUST_BACKTRACE=1`. Le filet cdb écrit un cliché sur `c0000374` et sur `c0000409` (arrêt sur panique). Pas de série ni de banc dédiés. Une recette Tauri qui meurt est consignée ici en une ligne (recette, code de sortie, pile). Un échec qui n'est pas un défaut déjà identifié arrête la série en cours et passe par `BLOCAGES.md` ; une série ne se rejoue pas pour le chiffre.
- **Suite** : Écran de connexion, Modèles et fusion, Conventions d'honoraires, Facturation suite, Tableau de bord, J12 à J17.
- **Dette ouverte** : le crash `0xC0000374` de `powersync_core` bloque J14 (aucune distribution). Signalement prêt : `docs/signalements/powersync-native-c0000374.md`. Le commandement le poste (B22).
- **Blocages** : B6, B7, B8, B15 à B17, B19, B22 ; voir `BLOCAGES.md`.
- **CI** : l'état d'un run se lit par `gh run view` à chaque fois ; attendre = `gh run watch <id> --exit-status`.
- **Gouvernance de `PLAN.md`** : règle de l'ordre § 4.4 ; contrôle `tests/recette/plan-gouvernance.mjs`.

- **Finition, écran Dossiers (28/10).** La liste n'est plus coupée à 50. Filtres Actifs, Échéance proche, Restreints et Clos avec compteurs ; tri par prochaine échéance en groupes ; recherche sur tous les dossiers, clos compris ; aperçu à droite ; création dans le panneau de droite, la liste restant visible. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/dossiers/listeDossiers.test.ts` : 5/5. `pnpm --filter @legal-os/poste typecheck` exit 0. Le préfixe « 000 » des dossiers de `tests/recette/agenda-tauri.mjs` est retiré. Recettes Tauri et captures pas encore rejouées.

- **Finition, recette dossiers (28/10).** `node tests/recette/reference-dossier-ecran.mjs` exit 0. Hors ligne : liste, étiquette et onglet « Référence en attente », SQLite NULL. Après le retour du réseau : étiquette « Dossier RN/26/20260984 », onglet « RN/26/20260984 ». L'étiquette ne préfixe plus « Dossier » devant le libellé d'attente. La création laisse le formulaire et la liste visibles. `node --import ./tests/recette/lib/enregistrer-alias.mjs tests/recette/reference-modele-poste.mjs` exit 0.

- **Finition, écran Agenda (28/10).** Mini-calendrier, filtres par type avec compteurs, prochaines échéances, éléments simultanés côte à côte, « Voir le calcul » sur une échéance calculée. La liste lue par les recettes et la suppression confirmée restent en place. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/agenda/dispositionAgenda.test.ts apps/poste/src/agenda/navigationAgenda.test.ts` : 13/13. `pnpm --filter @legal-os/poste typecheck` et eslint de ces fichiers : exit 0. `node tests/recette/agenda-tauri.mjs` exit 0 (échéance recalculée, suppression confirmée et tracée, conflit signalé). Deux postes de copie sont sortis `0xc0000354` (le débogueur qui quitte, pile dans le journal du filet : notifications Windows), la recette a continué.

- **Finition, Réglages (28/10).** La navigation n'affiche que les sections livrées : Cabinet, Messagerie, Apparence, Référence des dossiers. Collaborateurs et droits, Modèles de documents, Taux et facturation, Postes et sécurité restent absents. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/screens/sectionsReglages.test.ts` : 2/2. eslint et `pnpm --filter @legal-os/poste typecheck` : exit 0.

- **Finition, Temps (28/10), lecteur de durée.** « 1 h 30 » = 90 min, « 45 min » = 45, « 0,75 » = 45. « 60 » reste 60 minutes. Vide, zéro, « 1 h 60 » et un texte illisible sont refusés. Le formulaire affiche minutes, montant et taux avant l'enregistrement. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/facturation/lireDuree.test.ts` : 4/4. eslint et typecheck : exit 0.

- **Finition, écran Temps (28/10).** Le menu Temps ouvre l'écran, plus une fenêtre. Chronomètre : démarrer, pause (le temps ne avance plus), arrêt confirmé en minutes (au moins une), reprendre. La pastille de la barre suit ce chronomètre sur tous les écrans ; la touche T ouvre Temps hors d'un champ. Liste par jour, filtres Toutes, Non facturées, Facturées, Le cabinet et Mes temps, résumé non facturé et sept jours. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/facturation/chronoTemps.test.ts` : 3/3. eslint et typecheck : exit 0. `menu-compte-tauri` attend désormais l'écran. Recette Tauri de l'écran pas rejouée.

- **Finition, La journée (28/10).** Quatre sections alimentées par la base locale (la galerie garde le jeu fictif). Classement d'un mail suggéré en un clic par `classerMessage`, le même chemin que l'écran Mails. Temps à saisir tirés des mails classés (barème de lecture) et des tâches du jour. Les délais du moteur portent « Calculé ». `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/screens/assemblerJournee.test.ts` : 3/3. eslint et typecheck : exit 0.

- **Finition, captures (28/10).** `node tests/recette/coque-app.mjs --captures` exit 0 (Playwright sur le cache système, pas le cache du bac à sable). Jetons, testids, lint et typecheck verts. Captures rafraîchies : dossiers, agenda (jour et semaine), réglages, jour et nuit. Lecture : Dossiers a la liste, les filtres et l'aperçu ; Agenda a le mois, les filtres, les prochaines échéances et « Voir le calcul » ; Réglages n'a que Cabinet, Messagerie, Apparence et Référence des dossiers. La comparaison du contrôleur aux maquettes n'est pas faite. Le jalon n'est pas coché.

- **Finition, comparaison visuelle (28/10).** Contrôleur [captures](d8c8db5f-b08d-41ad-a935-ed93d8075e52) : refus visuel pour Dossiers, Agenda, Réglages et La journée (jour et nuit). Bloquant : aperçu Dossiers incomplet (pas de procédure, ni derniers éléments, ni temps) ; agenda sans volet d'aperçu ni grille horaire ; réglages sans rail gauche et sans la fiche Cabinet de la maquette ; La journée sans les actions (classer, saisir, ouvrir) ni l'anneau de délai. Temps : pas de capture de galerie, non comparé. Détail : pastille d'onglet, espacements. Le jalon n'est pas coché. Aucun fichier de production modifié par le contrôleur.

- **Finition, suite du refus visuel (28/10).** L'agenda a un volet d'aperçu (`agenda-apercu`). La journée affiche « Ouvrir l'agenda », « Voir tous les délais », « Ouvrir les mails », « Ouvrir le temps », le bouton Classer, le bouton Saisir, et « Calculé » sur un délai du jeu de galerie. `node tests/recette/coque-app.mjs --captures` exit 0 à nouveau. Le refus du contrôleur n'est pas soldé : grille horaire, fiche Cabinet, blocs de l'aperçu Dossiers. Le jalon n'est pas coché.

- **Finition, grille horaire (28/10).** L'agenda affiche les heures de 8 h à 19 h (`agenda-grille`). Audiences et rendez-vous s'y placent, y compris côte à côte s'ils se recouvrent. Tâches et échéances calculées restent dans la bande « Sans heure ». `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/agenda/dispositionAgenda.test.ts` : 7/7. eslint et typecheck : exit 0.

- **Finition, aperçu Dossiers (28/10).** L'aperçu a la procédure (étape courante entre les faites et les suivantes), les trois derniers éléments, et le temps non facturé à côté du montant facturé. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/dossiers/apercuDossier.test.ts` : 3/3. eslint et typecheck : exit 0.

- **Finition, fiche Cabinet (28/10).** Rail gauche des sections livrées. La fiche Cabinet montre le nom et le slug, les seuls champs enregistrés. Les autres sections restent dans la page, masquées, pour les recettes. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, La journée (28/10), heure et délais.** Colonne d'heure (« 9 h 30 », « 14 h 00 »). Anneau et « dans N jours » (un jour au singulier). Case à cocher sur les tâches, tenue dans l'écran seulement : aucune colonne ne mémorise l'état. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/screens/assemblerJournee.test.ts` : 3/3. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, dock de l'agenda (28/10).** « Nouvel élément » et « Calculer un délai » sont dans le dock. Le second ouvre le formulaire de calcul déjà utilisé dans un dossier, et inscrit l'échéance si un dossier est sélectionné. Le titre et l'heure d'un créneau sont sur deux lignes. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, ligne de dossier (28/10).** L'anneau, le titre et la date de la prochaine échéance figurent sur la ligne. « 1 jour » au singulier. Le nombre de mails non lus du dossier s'affiche quand il est supérieur à zéro. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/dossiers/apercuDossier.test.ts` : 4/4. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, comparaison visuelle (28/10).** Contrôleur [captures](d755c953-1186-4e5f-bc49-fb092996a1bc) : refus pour Dossiers, Agenda, Réglages et La journée, jour et nuit. Bloquant : aperçu Dossiers sans client, adversaire ni montant encaissé ; agenda sans fiche visible et semaine empilée sur un seul jour ; dock sans « Saisir du temps » ; Réglages sans les champs Cabinet absents du schéma (SIREN, TVA, adresse, IBAN) et avec la section Référence des dossiers, qui existe ; La journée sans « Autre dossier », sans extrait, sans bandeau non facturé. Temps non comparé : pas de capture. Le jalon n'est pas coché.

- **Finition, semaine et fiche (28/10).** La semaine aligne lundi à vendredi, et le week-end seulement s'il a un élément. La fiche est à droite de la grille. « Saisir du temps » est de retour dans le dock. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/agenda/navigationAgenda.test.ts` : 9/9. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, non facturé et parties (28/10).** La journée affiche le temps non facturé et son montant HT, avec « Ce qui reste à facturer ». L'aperçu d'un dossier nomme le client et l'adversaire quand ces rôles existent. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/dossiers/apercuDossier.test.ts` : 5/5. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, mails de La journée (28/10).** Un mail suggéré montre son extrait quand il en a un, et « Autre dossier » ouvre le choix d'un autre dossier, classé par le même chemin que « Classer ». Pas de motif de suggestion : le message n'en porte pas. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/screens/assemblerJournee.test.ts` : 3/3. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, capture Temps (28/10).** L'écran Temps est dans la galerie : chronomètre en pause, saisie, filtres, résumé et liste par jour en français. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0. Captures `temps-jour.png` et `temps-nuit.png`.

- **Finition, comparaison Temps (28/10).** Contrôleur [Temps](c5523746-0889-4e37-98d4-78c66023cc60) : refus, jour et nuit. Bloquant : pas de volet (non facturé, sept jours, par dossier), chronomètre et saisie empilés, pastille absente de la barre, pas de barre d'actions. Le jalon n'est pas coché.

- **Finition, volet Temps (28/10).** Colonne de droite : durée et montant non facturés, sept jours, total par dossier, « Le taux est figé à la saisie ». Chronomètre et saisie côte à côte. Pastille dans la barre. Dock : Saisir du temps, Facturer. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/facturation/chronoTemps.test.ts` : 3/3. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, taux sur la ligne (28/10).** Chaque saisie affiche le taux horaire figé, en euros par heure. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, pastille Temps (28/10).** Chaque ligne porte la pastille de la chemise du dossier, lue en base. La galerie montre le kraft et le vert amande. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, taux en euros (28/10).** Le champ de saisie demande des euros par heure (« 60 » ou « 60,50 »). L'enregistrement reste en centimes. `s9-poste-tauri` saisit « 60 », qui vaut 6 000 centimes. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/messagerie/tempsMail.test.ts` : 22/22. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, comparaison Temps, suite (28/10).** Contrôleur [Temps](217ce991-88ae-4b3e-99cc-e14695f7d94f) : refus, jour et nuit. Le volet, le taux en euros et le dock sont en place. Il manquait la référence dans la pastille, le montant par dossier et l'histogramme des sept jours. Pas d'intervenant dans le formulaire : la liste des collaborateurs n'est pas livrée. La suggestion de temps reste celle de J11, sur l'écran Mails. Le jalon n'est pas coché.

- **Finition, pastille et histogramme (28/10).** La pastille porte la référence du dossier. Le volet montre le montant non facturé par dossier et les sept jours en barres. Sous le titre : minutes du jour et durée non facturée. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, lint et flux (28/10).** `pnpm --filter @legal-os/poste lint:ci` exit 0. `node tests/recette/s5-sync-streams.mjs` exit 0 (dossier restreint : flux `dossier_acces`). Le jalon n'est pas coché.

- **Finition, agenda Tauri (28/10).** `node tests/recette/agenda-tauri.mjs` exit 0 en 225 s (échéance recalculée, suppression confirmée et tracée, conflit signalé, restreint absent du second poste). Deux postes de copie sont sortis `0xc0000354` (le débogueur qui quitte, pile dans les notifications Windows). La recette a continué jusqu'à « tous les critères ». Le jalon n'est pas coché.

- **Finition, CI (28/10).** Le job rust de [40688866767](https://github.com/navelremi-boop/legalos2/actions/runs/40688866767) (`5e5a71b`) a d'abord échoué : `install_demarre_en_production_sans_demo`, l'instance ne répond pas. Relance du job : exit 0, rust et s1 verts. La CI de `3ae7bac` [40692356106](https://github.com/navelremi-boop/legalos2/actions/runs/40692356106) est verte (frontend, gouvernance, périmètre) ; rust et s1 sont sautés, le commit ne touche que le journal. Le jalon n'est pas coché.

- **Finition, nom sur la ligne (28/10).** La ligne de temps montre le nom déjà enregistré de l'intervenant. Le chronomètre en cours porte la référence du dossier. Pas de liste pour choisir un autre intervenant. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, comparaison Temps (28/10), suite.** Contrôleur [Temps](66699bc0-50e6-4ba6-b2ba-cf1cd35eb779) : refus, jour et nuit. Le volet, le taux, les pastilles, les noms et le dock sont en place. Bloquant : la liste passait sous le volet, pas de pastille « Chronomètre en cours », la ligne par dossier sans référence, la pilule de la barre après Synchronisé et sans la chemise. Le jalon n'est pas coché.

- **Finition, colonne Temps (28/10).** Le volet reste à droite, séparé par un filet, avec la référence du dossier. La pastille « Chronomètre en cours sur … » est sous le titre. La pilule de la barre précède Synchronisé et prend la chemise du dossier. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, comparaison commune (28/10).** Contrôleur [écrans](a0b3f4f1-d09e-4e02-a252-5b87404ffb50) sur `6bc950d` : Réglages conforme. Dossiers, Agenda, La journée et Temps refusés, jour et nuit. Il n'y a pas de montant encaissé en base. Le jalon n'est pas coché.

- **Finition, pastilles et procédure (28/10).** La procédure marque l'étape faite et l'étape en cours. L'aperçu a Nouveau mail et Saisir du temps. La journée montre la référence dans la pastille et la pilule du chronomètre. `node --import ./tests/recette/lib/enregistrer-alias.mjs --test apps/poste/src/screens/assemblerJournee.test.ts` : 3/3. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, fiche d'agenda (28/10).** La fiche montre le dossier, sa référence, le rappel enregistré et « Ouvrir le dossier ». Il n'y a pas de colonne lieu. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, bouton Enregistrer (28/10).** La saisie de temps a un bouton « Enregistrer ». « Valider » n'apparaît qu'une fois le brouillon écrit ; `s9-poste-tauri` le clique par son identifiant. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

- **Finition, aperçu du taux (28/10).** Avant toute durée, la saisie affiche le taux (« Taux 60,00 € par heure »). Le montant s'y ajoute dès que la durée se lit. `node tests/recette/coque-app.mjs --captures` exit 0. eslint et typecheck : exit 0.

**Prochaine action.** La preuve visuelle commune reste un refus (fiche d'agenda sans lieu, pas de montant encaissé). Le jalon n'est pas coché.
