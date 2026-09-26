# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-27 (jalon en cours : **Référence de dossier**, personnalisation comprise).

Références : `docs/cahier-des-charges.md`, `docs/ordre-operation.md`, scénarios S1–S14.

Règle (ordre d'opération § 4.4) : les critères d'un jalon non validé et les dettes ouvertes ne se suppriment, ne s'affaiblissent ni ne se remplacent par un renvoi au cahier ; seul l'architecte les modifie ; toute modification de ce fichier fait l'objet d'un commit dédié préfixé « plan: ». Contrôle outillé : `node tests/recette/plan-gouvernance.mjs`.

---

## Phase 0 — Reconnaissance et planification

- [x] **J0** — Phase 0 complète — VALIDÉ (contrôleur, détail dans `docs/journal/phase-0.md`)

---

## Phase 1 — Fondations (gate : contrôleur avant phase 2)

- [x] **J1** — Instance S1 — VALIDÉ (détail dans `docs/journal/phase-1.md`)
- [x] **J2** — Auth API, 2FA, premier lancement — VALIDÉ `3f4647d` (CI [36134053175](https://github.com/navelremi-boop/legalos2/actions/runs/36134053175))
- [x] **J3** — Sync bout en bout Tauri — VALIDÉ `86e0856` (CI [36155397731](https://github.com/navelremi-boop/legalos2/actions/runs/36155397731))
- [x] **J4** — Build Tauri, polices, pas de WebDriver — VALIDÉ `7871c68` (CI [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952))
- [x] **Gate phase 1** — VALIDÉ (CI [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952) et [36166067737](https://github.com/navelremi-boop/legalos2/actions/runs/36166067737))

---

## Phase 2 — Lots parallèles

Ordre architecte (révisé 2026-09-27) : **Migration Sync Streams** → **J8** → **Référence de dossier** (personnalisation comprise) → **Conflits généralisés** → **Coque** → **Vue scindée** → **Intercalaires personnalisés** → **J9** → **J10**.

- [x] **J5** — Dossiers, contacts, droits — VALIDÉ `340ac42` (CI [36172577399](https://github.com/navelremi-boop/legalos2/actions/runs/36172577399))
- [x] **J6** — Agenda et délais — VALIDÉ `bf3bfe3` (CI [36179592258](https://github.com/navelremi-boop/legalos2/actions/runs/36179592258)) ; reprise H1–H13 `0fc0c17` ; H7/H10/H12 → B10
- [x] **J7** — Documents et versions — VALIDÉ `5ff58b9` (CI [36232407821](https://github.com/navelremi-boop/legalos2/actions/runs/36232407821))
- [x] **Migration Sync Streams** — VALIDÉ `9f80388` (CI [36265441004](https://github.com/navelremi-boop/legalos2/actions/runs/36265441004))
- [x] **J8** — Temps et facturation électronique (S9) — VALIDÉ `e8eb6b2` (CI [36269667975](https://github.com/navelremi-boop/legalos2/actions/runs/36269667975))

- [ ] **Référence de dossier** — § 3.4, arbitrage R0 (référence personnalisable) et son complément du 27/09 — **jalon en cours**
  - **Validation partielle** : contrôleur VALIDÉ sur `6a1a050` (CI [36272379503](https://github.com/navelremi-boop/legalos2/actions/runs/36272379503)) pour l'attribution serveur au format fixe. La personnalisation n'est pas livrée : jalon non validé.
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/reference-dossier.mjs` → exit 0 : le poste n'écrit jamais de référence ; « Référence en attente » tant que le serveur n'a pas attribué la référence.
    - `node tests/recette/reference-dossier-api.mjs` → exit 0 : attribution par le serveur dans une transaction, avec unicité ; créations concurrentes sans doublon ni trou ; rejeux, dont dix envois simultanés du même dossier ; dossier restreint refusé hors de `dossier_acces` ; référence jamais modifiée.
    - `node tests/recette/reference-dossier-controleur.mjs` → exit 0 : immutabilité garantie en base ; remise à zéro annuelle ; séquence propre à chaque cabinet.
    - `node tests/recette/reference-deux-postes-tauri.mjs` → exit 0 : deux postes Tauri créent des dossiers en même temps, dont hors ligne avec retour du réseau simultané ; références distinctes, sans doublon ni trou.
    - `node tests/recette/j5-poste-tauri.mjs` → exit 0 : coupure réseau réelle ; « Référence en attente » puis référence attribuée par le serveur.
    - `node tests/recette/reference-dossier-ecran.mjs` → exit 0 : étiquette « Dossier <référence> » et libellé d'attente à l'écran.
    - `node tests/recette/reference-modele.mjs` → exit 0 (API, Postgres réel) :
      - modèle propre au cabinet ; jetons `{AAAA}`, `{AA}`, `{N}`, `{N:k}`, `{INI}` ; « / » admis comme texte libre ;
      - modèles `{AAAA}/{N:3}`, `RN/{AA}/{N:4}`, `{N}/{AAAA}` et un modèle sans aucun séparateur, attribués par l'API ; référence stockée et renvoyée avec ses « / » intacts ;
      - chaque politique de remise à zéro ;
      - numéro de départ ;
      - refus des modèles invalides ;
      - refus de tout changement (modèle, politique, numéro de départ) qui redonnerait une référence existante ; aucune référence déjà attribuée n'est régénérée.
    - `cargo test -p legalos-domaine reference` → exit 0 : formes normalisées, seulement pour l'adresse de classement (« / » et caractères mal acceptés par les messageries → « - ») et pour les noms de fichiers et de dossiers de l'export (`/ \ : * ? " < > |` → « - ») ; reconnaissance d'une référence sous sa forme d'origine comme sous sa forme normalisée.
    - `node tests/recette/reference-modele-ecran.mjs` → exit 0 (app Tauri) :
      - Réglages : modèle texte et constructeur visuel par blocs (Année, Numéro avec nombre de chiffres, Initiales, Texte) ; entre chaque bloc, séparateur « / », « - », « . », « _ », espace ou aucun ; aperçu en direct ; les deux vues restent synchronisées ;
      - référence affichée et retrouvée par la palette avec ses « / » intacts.
    - `cargo clippy --workspace --all-targets -- -D warnings` et `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.
  - **Responsables** : instance-backend (API, domaine), poste-interface (Réglages, palette).

- [ ] **Conflits généralisés** — § 3.4, invariant n° 2 (consignes architecte 1 et 2 du 26/09)
  - **Critères d'acceptation (commandes)** :
    - `cargo test -p legalos-api --test conflits_integration` → exit 0 (Postgres réel), pour dossiers, parties, temps, brouillons de facture et taux horaires :
      - révision de base envoyée avec chaque modification ;
      - dernière écriture gagnante par champ ;
      - valeur remplacée journalisée, avec `dossier_id` (nul pour les enregistrements du cabinet) ;
      - rejeu sans second effet ; donnée validée immuable.
    - `node tests/recette/s5-sync-streams.mjs` → exit 0 : journal en trois flux, cabinet (`dossier_id` nul), dossiers publics et dossiers restreints (mêmes jointures que les tables filles) ; plus de journal dans `cabinet_global`. Livré avant qu'une autre table que `cabinets` n'alimente le journal (bloquant).
    - `node tests/recette/conflits-poste-tauri.mjs` → exit 0 (deux postes Tauri, coupure réseau réelle) :
      - un conflit par table (dossiers, parties, temps, brouillons, taux), avec une modification hors ligne ;
      - conflit signalé dans l'app ;
      - S5 : conflit provoqué sur un dossier restreint ; l'entrée du journal est absente du SQLite du poste non autorisé ;
      - dette J3 devenue critère, « fausse alerte de conflit » : une écriture séquentielle du même poste après reprise n'est pas journalisée comme conflit.
    - `node tests/recette/j3-poste-tauri.mjs` → exit 0 (non-régression des cinq points du § 3.4).
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.
  - **Responsables** : instance-backend (API, migration, flux), poste-interface (file d'envoi, signal dans l'app).

- [ ] **Coque de l'app** — cahier § 7, version 5 (code sur `a24d0a2`, écarts de captures corrigés `22d765e`)
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/coque-app.mjs` → exit 0 :
      - `design/tokens.css` conforme au § 7.3 : couleurs de base, huit chemises à quatre valeurs (fond, teinte, texte, accent), jour et nuit, fond `neutre`, tuile de grain embarquée ; thème shadcn réécrit à partir de ces jetons ;
      - composants du § 7.4, jour et nuit : barre du haut, étiquette avec référence, informations du dossier, jauge d'échéance, feuille, intercalaires standards, barre d'actions flottante ;
      - hors dossier, fond `neutre` ; La journée selon le § 7.6 ;
      - recettes sur des `data-testid` stables.
    - `node tests/recette/points-medians.mjs` → exit 0, en CI : aucun « · » dans un texte d'interface (La journée : « TJ Nanterre, 9 h 30 » ; « échéance le 3 oct., dans 5 jours »).
    - `node tests/recette/coque-fonctions-tauri.mjs` → exit 0 (app Tauri) :
      - fonctions à leur place définitive : nouveau dossier depuis la palette et la vue Dossiers ; saisie de temps rattachée à un dossier, depuis la barre d'actions et le chronomètre ; calcul de délai depuis la barre d'actions (type choisi dans la bibliothèque, lieu où demeure la partie : métropole, outre-mer, étranger) ; nom du cabinet et thème dans Réglages ;
      - synchronisation invisible : aucun bouton « hors ligne » ou « en ligne » ; pendant une coupure réelle, « Hors ligne, N modifications en attente », puis « Synchronisé ».
    - `node tests/recette/galerie-absente.mjs` → exit 0 : galerie de démonstration réservée au développement, absente du build distribué (vérifiée sur le build).
    - `node tests/recette/coque-app.mjs --captures` : captures jour et nuit de la vue dossier (trois couleurs de chemise) et de La journée, comparées au prototype par le contrôleur.
    - `node tests/recette/cors.mjs` → exit 0 : dette CORS soldée (voir les dettes transverses).
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 (aucune couleur en dur) ; contrôleur VALIDÉ ; CI verte.
  - **Dettes à solder avant sa validation** : les deux dettes « Avant la fin de la Coque » ci-dessous.

- [ ] **Vue scindée** — § 7.4, intercalaire Chrono
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/vue-scindee-tauri.mjs` → exit 0 (app Tauri) :
      - chrono groupé par période (Aujourd'hui, Cette semaine, Plus tôt) ; filtres (Tout, Mails, Pièces, Factures) ;
      - chaque ligne : tuile d'icône, titre, métadonnées, puis l'heure ou un badge ; sélection à la teinte de la chemise ;
      - aperçu selon le type d'élément : mail, pièces, facture, audience, note ;
      - badges « définitif » (cadenas et libellé : Communiquées, Validée, Encaissée, Envoyé, en `definitif`), réservés à ce qui ne peut plus être modifié.
    - `node tests/recette/coque-app.mjs --captures` : captures jour et nuit de la vue scindée, comparées au prototype par le contrôleur.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Intercalaires personnalisés** — § 7.4
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/intercalaires-tauri.mjs` → exit 0 (deux postes Tauri) :
      - « + Intercalaire » avec saisie du nom ; croix pour retirer un intercalaire personnalisé ;
      - table synchronisée, soumise aux droits du dossier ;
      - rattacher un élément ne le retire pas du chrono ;
      - retirer un intercalaire ne supprime rien : les éléments rattachés restent en base, dans le chrono et sur l'autre poste ;
      - les intercalaires standards ne se retirent pas ;
      - conflits par champ comme les autres tables (consigne 2 du 26/09) : révision de base, journal, conflit signalé.
    - `node tests/recette/s5-sqlite-par-flux.mjs` et `node tests/recette/j5-poste-tauri.mjs` → exit 0 : S5 pour la table des intercalaires ; l'intercalaire d'un dossier restreint est absent du SQLite du poste non autorisé.
    - `node tests/recette/s5-sync-streams.mjs` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **J9** — Mail, étapes 1 à 3 du § 3.8.6 (S7) — critères proposés le 27/09 d'après les § 3.8.1 à 3.8.6, **à valider par l'architecte**
  - **Critères proposés (commandes)** :
    - Étape 1, boîte de classement : `node tests/recette/s7-classement.mjs` → exit 0 (serveur de test GreenMail) :
      - un mail adressé à l'adresse de classement d'un dossier (forme normalisée de la référence) est rattaché à ce dossier ;
      - un mail portant la référence dans l'objet, sous sa forme d'origine ou normalisée, est classé automatiquement ; de même pour un correspondant lié à un seul dossier actif ;
      - sinon, suggestion à valider d'un clic, puis corbeille « À classer » ;
      - mail classé visible dans le chrono du dossier, sur le poste.
    - Étape 2, envoi depuis un dossier : `node tests/recette/s7-envoi.mjs` → exit 0 :
      - cycle de vie du § 3.8.3 visible dans l'app : brouillon, en attente (annulable), envoyé, copie dans « Envoyés » confirmée, échec avec nouvelle tentative ;
      - coupure réseau simulée pendant l'envoi : ni perte, ni doublon (identifiant de message généré une seule fois, vérification dans « Envoyés » avant toute nouvelle tentative) ;
      - copie classée dans le dossier.
    - Étape 3, boîtes nominatives : `node tests/recette/s7-synchro.mjs` → exit 0 :
      - synchronisation incrémentale, notification immédiate sur la boîte de réception, resynchronisation complète si le serveur l'impose ;
      - lu, déplacement, suppression, drapeau appliqués au serveur IMAP ; retour à l'état réel en cas de refus ;
      - HTML nettoyé (`ammonia`) avant stockage ; recherche hors ligne (FTS5) et sur tout l'historique côté serveur (index Postgres en français) ;
      - boîte de test d'au moins 50 000 messages générés (ordre § 6) : durée de synchronisation mesurée et consignée.
    - `node tests/recette/s7-poste-tauri.mjs` → exit 0 : S5, les mails d'un dossier restreint sont absents du SQLite du poste non autorisé ; un compte nominatif n'est visible que de son titulaire ; aucun identifiant de messagerie sur le poste.
    - `cargo test -p legalos-messagerie` (contre GreenMail) et `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; ni protocole IMAP ni décodeur MIME écrit à la main (bibliothèques consignées dans `docs/versions.md`) ; contrôleur VALIDÉ ; CI verte.

- [ ] **J10** — Écrans restants du § 7.6, après la Coque — critères proposés le 27/09 d'après le § 7.6, **à valider par l'architecte**
  - **Critères proposés (commandes)** :
    - `node tests/recette/j10-ecrans-tauri.mjs` → exit 0 (app Tauri) :
      - La journée, Dossiers, Mails, Agenda, Facturation et Réglages : barre du haut, espace de travail, feuille, barre d'actions ; hors dossier, fond `neutre` sans étiquette de dossier ;
      - La journée : feuille en quatre sections (audiences et rendez-vous du jour, délais, mails à classer avec leur suggestion de dossier, temps à saisir) ; pastille sur chaque dossier cité ; barre d'actions Nouveau dossier, Nouveau mail, Saisir du temps ;
      - Mails : feuille en trois volets (comptes et dossiers IMAP, liste, lecture) ; pastille du dossier sur chaque mail classé ; bandeau « Classer dans … » en tête d'un mail non classé ;
      - Agenda, Facturation, Réglages : feuille unique, construite avec les mêmes composants.
    - `node tests/recette/points-medians.mjs` et `pnpm --filter @legal-os/poste lint:ci` → exit 0.
    - `node tests/recette/coque-app.mjs --captures` : captures jour et nuit de chaque nouvel écran, revues par le contrôleur au regard du § 7, puis validées par le commandement (B9).
    - Contrôleur VALIDÉ ; CI verte.

### Dettes transverses (§ 4.4)

- [x] **Immédiat** : `garde-commandes` et `garde-secrets` refusent, et le signalent, quand ils ne parviennent pas à lire leur entrée — `node tests/recette/garde-hooks.mjs`.
- [x] **Immédiat** : images et compilations depuis un arbre de travail en CRLF (majeur 1 du contrôle Référence) — `Dockerfile.api` ramené en LF ; `node tests/recette/encodage-texte.mjs` ; outil `instance/outils/realigner-migrations-lf.mjs`.
- [ ] **Avant la fin de la Coque** : CORS — ajouter `tauri://localhost` ; `localhost:1420` accepté seulement en mode développement.
- [ ] **Avant la fin de la Coque** : onglets de démonstration aux références écrites en dur (`CoqueApp.tsx:56`, majeur 2 du contrôle Référence) ; onglets à 800 px (réduction, puis menu des dossiers ouverts) ; indicateur « Synchronisé » affiché pendant une coupure ; contenu de démonstration dans la vue d'un vrai dossier.
- [ ] **Avant J14** : feature `test-webdriver` réalisée (WebDriver embarqué, WebdriverIO) pour les scénarios de l'app, aussi en CI macOS.
- [ ] **Avant J14** : build distribué sans outils de développement ni débogage distant, vérifié par un test.
- [ ] **Avant la fin de la phase 2** : `cargo-deny` (ou `cargo-audit`) en CI sur les deux workspaces ; signalement préparé pour PowerSync / dépendance `time` 0.2.
- [ ] **Avant la fin de la phase 2** : moteur de délais en TypeScript strict ; licence OFL livrée avec les polices.
- [ ] **Mensuel** : avis de sécurité PowerSync (GHSA, édition 3) relus et consignés dans `docs/versions.md`.

Chaque jalon : recettes + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

Critères de chaque jalon à proposer à l'architecte avant l'ouverture de la phase 3.

- [ ] **J11** — Mail étapes 4–5
- [ ] **J12** — Révocation postes (S10)
- [ ] **J13** — Export complet (S12) ; noms de fichiers et de dossiers avec la forme normalisée de la référence (R0)
- [ ] **J14** — Mises à jour à chaud et distribution (S11, S14a)

---

## Phase 4 — Durcissement et recette

Critères de chaque jalon à proposer à l'architecte avant l'ouverture de la phase 4.

- [ ] **J15** — `cargo xtask recette` S1–S14a (Windows)
- [ ] **J16** — S14b macOS CI + captures S13
- [ ] **J17** — Revue sécurité, `RAPPORT.md`, `.mission/TERMINEE`

---

## Rappel

Un jalon n'est coché que si § 4.4 de l'ordre d'opération est entièrement satisfait (preuves dans `JOURNAL.md`).
