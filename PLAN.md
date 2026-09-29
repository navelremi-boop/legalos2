# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-29 (jalon en cours : **Dossiers et contacts complets**).

Références : `docs/cahier-des-charges.md`, `docs/ordre-operation.md`, scénarios S1–S14.

Règle (ordre d'opération § 4.4) : les critères d'un jalon non validé et les dettes ouvertes ne se suppriment, ne s'affaiblissent ni ne se remplacent par un renvoi au cahier ; seul l'architecte les modifie ; toute modification de ce fichier fait l'objet d'un commit dédié préfixé « plan: ». Contrôle outillé : `node tests/recette/plan-gouvernance.mjs`.

---

## Couverture V1

Chaque fonctionnalité n° 1 à 14 du § 4.2, et chaque élément de sa colonne « Détail », est rattaché à un jalon. Un élément sans jalon, ou rattaché à un jalon absent de ce plan, fait échouer `node tests/recette/plan-gouvernance.mjs`.

- **1 Dossiers**
  - Référence attribuée par le serveur → Référence de dossier
  - client → Dossiers et contacts complets
  - adversaires → Dossiers et contacts complets
  - confrères adverses → Dossiers et contacts complets
  - juridiction → J5
  - n° RG → J5
  - type de dossier → Dossiers et contacts complets
  - étape → Dossiers et contacts complets
  - dossiers liés → Dossiers et contacts complets
  - intercalaires standards → Coque de l'app
  - intercalaires personnalisés → Intercalaires personnalisés
- **2 Contacts**
  - personnes physiques et morales → Dossiers et contacts complets
  - rôle dans chaque dossier → Dossiers et contacts complets
  - historique → Dossiers et contacts complets
  - SIREN → Dossiers et contacts complets
  - n° TVA → Dossiers et contacts complets
  - type de client → Dossiers et contacts complets
- **3 Droits par dossier**
  - accès restreint à certains collaborateurs → J5
- **4 Agenda et délais**
  - audiences → Agenda
  - rendez-vous → Agenda
  - tâches → Agenda
  - rappels → Agenda
  - invitations reçues par mail → J11
- **5 Calcul des délais de procédure**
  - computation selon le CPC art. 640 à 642 → J6
  - augmentation pour distance art. 643-644 → J6
  - bibliothèque de délais usuels → J6
- **6 Documents**
  - arborescence par dossier → Documents, suite
  - versions → J7
  - ouverture dans Word avec renvoi automatique → Documents, suite
  - recherche → Documents, suite
- **7 Modèles et fusion**
  - courriers, conventions et actes générés depuis les données du dossier → Modèles et fusion
- **8 Client mail intégré**
  - client complet remplaçant Outlook → J9 ; J10 ; J11
  - classement dans les dossiers → J9
  - construit en 5 étapes → J9 ; J11
- **9 Temps**
  - chronomètre → Coque de l'app
  - saisie manuelle → J8
  - rattachement au dossier et à l'intervenant → J8
- **10 Facturation**
  - au temps → J8
  - au forfait → Facturation, suite
  - au résultat → Facturation, suite
  - provisions → Facturation, suite
  - débours → J8
  - conditions tarifaires par client, dossier et intervenant → Facturation, suite
  - avoirs → J8
  - relances → Facturation, suite
  - encours et impayés → Facturation, suite
- **11 Facturation électronique**
  - PDF et Factur-X → J8
  - dépôt sur la plateforme agréée → J8
  - e-reporting → J8
  - suivi des statuts → J8
  - statut encaissée → J8
- **12 Conventions d'honoraires**
  - modèle → Conventions d'honoraires
  - rattachement au dossier → Conventions d'honoraires
  - alerte si dossier sans convention signée → Conventions d'honoraires
- **13 Tableau de bord**
  - chiffre d'affaires → Tableau de bord
  - encours → Tableau de bord
  - temps non facturé → Tableau de bord
  - rentabilité par dossier et par client → Tableau de bord
  - factures en erreur ou en attente sur la plateforme agréée → Tableau de bord
  - mails à classer → Tableau de bord
- **14 Révocation des postes**
  - révocation et effacement à distance → J12

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

Ordre architecte (révisé 2026-09-27, couverture V1) : **Migration Sync Streams** → **J8** → **Référence de dossier** → **Conflits généralisés** → **Coque** → **Vue scindée** → **Intercalaires personnalisés** → **Dossiers et contacts complets** → **Agenda** → **Documents, suite** → **J9** → **J10**. Phase 3, avant J14 : **Modèles et fusion** → **Facturation, suite** → **Conventions d'honoraires** → **Tableau de bord**.

- [x] **J5** — Dossiers, contacts, droits — VALIDÉ `340ac42` (CI [36172577399](https://github.com/navelremi-boop/legalos2/actions/runs/36172577399))
- [x] **J6** — Agenda et délais — VALIDÉ `bf3bfe3` (CI [36179592258](https://github.com/navelremi-boop/legalos2/actions/runs/36179592258)) ; reprise H1–H13 `0fc0c17` ; H7/H10/H12 → B10
- [x] **J7** — Documents et versions — VALIDÉ `5ff58b9` (CI [36232407821](https://github.com/navelremi-boop/legalos2/actions/runs/36232407821))
- [x] **Migration Sync Streams** — VALIDÉ `9f80388` (CI [36265441004](https://github.com/navelremi-boop/legalos2/actions/runs/36265441004))
- [x] **J8** — Temps et facturation électronique (S9) — VALIDÉ `e8eb6b2` (CI [36269667975](https://github.com/navelremi-boop/legalos2/actions/runs/36269667975))

- [x] **Référence de dossier** — VALIDÉ `03ca364` (contrôleur, CI [36322383021](https://github.com/navelremi-boop/legalos2/actions/runs/36322383021))

- [x] **Conflits généralisés** — VALIDÉ `61e77c8` (contrôleur, CI [36357904754](https://github.com/navelremi-boop/legalos2/actions/runs/36357904754))

- [x] **Coque de l'app** — VALIDÉ `831e398` (contrôleur, CI [36475104465](https://github.com/navelremi-boop/legalos2/actions/runs/36475104465))

- [x] **Vue scindée** — VALIDÉ `f393190` (contrôleur, CI [36531714153](https://github.com/navelremi-boop/legalos2/actions/runs/36531714153))

- [x] **Intercalaires personnalisés** — VALIDÉ `9e0aa69` (contrôleur, CI [36561017502](https://github.com/navelremi-boop/legalos2/actions/runs/36561017502))

- [ ] **Dossiers et contacts complets** — § 4.2 n° 1 et 2, ce que J5 n'a pas livré — critères proposés le 27/09, **à valider par l'architecte**
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/dossiers-contacts.mjs` → exit 0 (API, Postgres réel, puis app Tauri) :
      - le dossier porte un client, des adversaires et des confrères adverses, une juridiction, un n° RG, un type et une étape ;
      - des dossiers liés se retrouvent dans les deux sens ;
      - un contact est une personne physique ou morale, avec un rôle dans chaque dossier et un historique ;
      - données de facturation : SIREN, n° TVA, type de client (professionnel, particulier, étranger), celles qu'utilise F8.
    - `node tests/recette/s5-sync-streams.mjs` et `node tests/recette/dossiers-contacts-conflits.mjs` → exit 0 : S5 sur ces tables ; conflits par champ (révision de base, journal, signal dans l'app), comme les autres tables.
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Agenda** — § 4.2 n° 4, ce que J6 n'a pas livré — critères proposés le 27/09, **à valider par l'architecte**
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/agenda-tauri.mjs` → exit 0 (app Tauri, deux postes) :
      - audiences, rendez-vous et tâches rattachés à un dossier, avec rappels ;
      - une notification Tauri est émise pour un rappel échu ;
      - une échéance calculée par le moteur de délais s'inscrit à l'agenda ;
      - les invitations reçues par mail restent au jalon J11.
    - `node tests/recette/s5-sync-streams.mjs` → exit 0 : un élément d'agenda d'un dossier restreint est absent du SQLite du poste non autorisé.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Documents, suite** — § 4.2 n° 6, ce que J7 n'a pas livré — critères proposés le 27/09, **à valider par l'architecte**
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/documents-suite.mjs` → exit 0 (app Tauri, S4) :
      - arborescence par dossier ;
      - ouverture dans Word et renvoi automatique de la nouvelle version ;
      - recherche dans les documents du dossier ;
      - modification concurrente hors ligne : les deux versions sont conservées et signalées, aucun écrasement silencieux.
    - `node tests/recette/s6-documents.mjs` → exit 0 (non-régression des versions).
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **J9** — Mail, étapes 1 à 3 du § 3.8.6 (S7) — critères validés par l'architecte le 27/09/2026
  - **Critères d'acceptation (commandes)** :
    - Étape 1, boîte de classement : `node tests/recette/s7-classement.mjs` → exit 0 (serveur de test GreenMail) :
      - un mail adressé à l'adresse de classement d'un dossier (forme normalisée de la référence) est rattaché à ce dossier ;
      - un mail portant la référence dans l'objet, sous sa forme d'origine ou normalisée, est classé automatiquement ; de même pour un correspondant lié à un seul dossier actif ; la reconnaissance couvre les références produites par tous les modèles utilisés par le cabinet (deux modèles successifs) ;
      - sinon, suggestion à valider d'un clic, puis corbeille « À classer » ;
      - une relève de la boîte de classement interrompue puis reprise ne perd aucun message et n'en crée aucun doublon ;
      - mail classé visible dans le chrono du dossier, sur le poste.
    - Étape 2, envoi depuis un dossier : `node tests/recette/s7-envoi.mjs` → exit 0 :
      - cycle de vie du § 3.8.3 visible dans l'app : brouillon, en attente (annulable), envoyé, copie dans « Envoyés » confirmée, échec avec nouvelle tentative ;
      - coupure réseau simulée pendant l'envoi : ni perte, ni doublon (identifiant de message généré une seule fois, vérification dans « Envoyés » avant toute nouvelle tentative) ;
      - copie classée dans le dossier.
    - Étape 3, boîtes nominatives : `node tests/recette/s7-synchro.mjs` → exit 0 :
      - synchronisation incrémentale, notification immédiate sur la boîte de réception, resynchronisation complète si le serveur l'impose ;
      - lu, déplacement, suppression, drapeau appliqués au serveur IMAP ; retour à l'état réel en cas de refus ;
      - HTML nettoyé (`ammonia`) avant stockage ; recherche hors ligne (FTS5) et sur tout l'historique côté serveur (index Postgres en français) ;
      - boîte de test d'au moins 50 000 messages générés (ordre § 6) : durée de synchronisation mesurée et consignée, une fois pour le chemin QRESYNC et une fois pour le repli par comparaison.
    - `node tests/recette/s7-poste-tauri.mjs` → exit 0 : S5, les mails d'un dossier restreint sont absents du SQLite du poste non autorisé ; un compte nominatif n'est visible que de son titulaire ; aucun identifiant de messagerie sur le poste.
    - `cargo test -p legalos-messagerie` (contre GreenMail) et `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; ni protocole IMAP ni décodeur MIME écrit à la main (bibliothèques consignées dans `docs/versions.md`) ; contrôleur VALIDÉ ; CI verte.

- [ ] **J10** — Écrans restants du § 7.6, après la Coque — critères validés par l'architecte le 27/09/2026
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/j10-ecrans-tauri.mjs` → exit 0 (app Tauri) :
      - La journée, Dossiers, Mails, Agenda, Facturation et Réglages : barre du haut, espace de travail, feuille, barre d'actions ; hors dossier, fond `neutre` sans étiquette de dossier ;
      - La journée : feuille en quatre sections (audiences et rendez-vous du jour, délais, mails à classer avec leur suggestion de dossier, temps à saisir) ; pastille sur chaque dossier cité ; barre d'actions Nouveau dossier, Nouveau mail, Saisir du temps ;
      - Mails : feuille en trois volets (comptes et dossiers IMAP, liste, lecture) ; pastille du dossier sur chaque mail classé ; bandeau « Classer dans … » en tête d'un mail non classé ;
      - Agenda, Facturation, Réglages : feuille unique, construite avec les mêmes composants.
    - `node tests/recette/points-medians.mjs` et `pnpm --filter @legal-os/poste lint:ci` → exit 0.
    - `node tests/recette/coque-app.mjs --captures` : captures jour et nuit de chaque nouvel écran, revues par le contrôleur au regard du § 7, validées par l'architecte ; le commandement garde son veto (B9).
    - Contrôleur VALIDÉ ; CI verte.

### Dettes transverses (§ 4.4)

- [x] **Immédiat** : `garde-commandes` et `garde-secrets` refusent, et le signalent, quand ils ne parviennent pas à lire leur entrée — `node tests/recette/garde-hooks.mjs`.
- [x] **Immédiat** : images et compilations depuis un arbre de travail en CRLF (majeur 1 du contrôle Référence) — `Dockerfile.api` ramené en LF ; `node tests/recette/encodage-texte.mjs` ; outil `instance/outils/realigner-migrations-lf.mjs`.
- [x] **Avant la fin de la Coque** : CORS — ajouter `tauri://localhost` ; `localhost:1420` accepté seulement en mode développement.
- [x] **Avant la fin de la Coque** : onglets de démonstration aux références écrites en dur (`CoqueApp.tsx:56`, majeur 2 du contrôle Référence) ; onglets à 800 px (réduction, puis menu des dossiers ouverts) ; indicateur « Synchronisé » affiché pendant une coupure ; contenu de démonstration dans la vue d'un vrai dossier.
- [ ] **Avant J14** : feature `test-webdriver` réalisée (WebDriver embarqué, WebdriverIO) pour les scénarios de l'app, aussi en CI macOS.
- [ ] **Avant J17** : revue juridique par l'avocat avant toute mise en service réelle (délais H1–H13, facturation F0–F8, installation) — `RAPPORT.md`, section du même nom.
- [ ] **Avant J14** : build distribué sans outils de développement ni débogage distant, vérifié par un test.
- [ ] **Avant J14** : épingler chaque action tierce de la CI sur un hash de commit complet, pas sur une étiquette (la CI manipulera alors les clés de signature) — liste dans `BLOCAGES.md`, contrôle `node tests/recette/workflows-valides.mjs`.
- [ ] **Avant la fin de la phase 2** : `cargo-deny` (ou `cargo-audit`) en CI sur les deux workspaces ; signalement préparé pour PowerSync / dépendance `time` 0.2.
- [ ] **Avant la fin de la phase 2** : moteur de délais en TypeScript strict ; licence OFL livrée avec les polices.
- [x] **Avant la fin de la phase 2** : la preuve « fausse alerte » de `node tests/recette/conflits-poste-tauri.mjs` aligne `revision_edition` par `fixerRevisionEdition` au lieu d'attendre la reprise réelle du même poste.
- [x] **Avant la fin de la phase 2** : `recetteHooks.ts` insère une entrée dans `ps_crud` lorsque le SDK ne journalise pas le PATCH hors ligne ; le chemin d'écriture réel reste à prouver sans cette injection.
- [ ] **Avant la fin de J9 et de Documents, suite** : brancher la vue scindée sur les éléments synchronisés (mails, pièces, factures), sans réintroduire de jeu fictif dans le dossier réel ni dans le build distribué.
- [ ] **Mensuel** : avis de sécurité PowerSync (GHSA, édition 3) relus et consignés dans `docs/versions.md`.

Chaque jalon : recettes + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

- [ ] **Modèles et fusion** — § 4.2 n° 7 — critères proposés le 27/09, **à valider par l'architecte**
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/modeles-fusion.mjs` → exit 0 (app Tauri) : un courrier, une convention et un acte sont générés depuis les données du dossier (docxtemplater) ; le modèle est modifiable sans recompiler le binaire.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Facturation, suite** — § 4.2 n° 10, ce que J8 n'a pas livré — critères proposés le 27/09, **à valider par l'architecte**
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/facturation-suite.mjs` → exit 0 (API, Postgres réel, puis app) :
      - facture au forfait et au résultat ;
      - provisions ;
      - conditions tarifaires par client, par dossier et par intervenant ;
      - relances ;
      - encours et impayés.
    - `node tests/recette/s9-factures.mjs` → exit 0 (non-régression du temps, des débours, des avoirs et de la facturation électronique).
    - `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Conventions d'honoraires** — § 4.2 n° 12 — critères proposés le 27/09, **à valider par l'architecte**
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/conventions-honoraires.mjs` → exit 0 (app Tauri) : une convention est produite depuis un modèle, rattachée au dossier ; l'ouverture d'un dossier sans convention signée affiche une alerte.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

- [ ] **Tableau de bord** — § 4.2 n° 13 — critères proposés le 27/09, **à valider par l'architecte**
  - **Critères d'acceptation (commandes)** :
    - `node tests/recette/tableau-de-bord.mjs` → exit 0 (app Tauri, requêtes locales) : chiffre d'affaires, encours, temps non facturé, rentabilité par dossier et par client, factures en erreur ou en attente sur la plateforme agréée, mails à classer.
    - `pnpm --filter @legal-os/poste lint:ci` → exit 0 ; contrôleur VALIDÉ ; CI verte.

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
