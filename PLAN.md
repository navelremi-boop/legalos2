# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-26 (cahier version 5 — J7 décoché, coque avant la suite de la phase 2).

Références : `docs/cahier-des-charges.md`, `docs/ordre-operation.md`, scénarios S1–S14.

---

## Phase 0 — Reconnaissance et planification

- [x] **J0** — Phase 0 complète (plan, journal, blocages, versions, dépôt, CI, contrats, validation contrôleur)
  - **Objectif** : fondations documentaires et contrats partagés avant tout lot parallèle.
  - **Livrables** : `PLAN.md`, `JOURNAL.md`, `BLOCAGES.md`, `docs/versions.md`, workspace Rust + pnpm, `design/tokens.css`, migrations initiales, schéma PowerSync client, `docs/sync-rules.md`, `instance/docker-compose.yml`, squelette `xtask`, CI GitHub Actions.
  - **Critères d'acceptation (commandes)** :
    - `pnpm --filter @legal-os/poste typecheck` → exit 0
    - `pnpm --filter @legal-os/poste build` → exit 0
    - `cargo fmt --check` et `cargo clippy --workspace --all-targets -- -D warnings` → exit 0 (poste avec rustup)
    - Fichiers contrats présents : `crates/api/migrations/`, `apps/poste/src/sync/AppSchema.ts`, `docs/sync-rules.md`, `design/tokens.css`
    - Verdict contrôleur **VALIDÉ** consigné dans `JOURNAL.md`
  - **Dépendances** : prérequis poste (voir `BLOCAGES.md` pour ce qui manque encore).
  - **Responsable** : état-major (+ `instance-backend`, `poste-interface` pour contrats).

---

## Phase 1 — Fondations (gate : contrôleur avant phase 2)

- [x] **J1** — Instance S1 (`docker compose up`, santé complète)
  - **Critères** : `cargo xtask recette --scenario s1` (ou `docker compose -f instance/docker-compose.yml ps` + healthchecks HTTP documentés) ; Caddy, API, Postgres, PowerSync, Garage, GreenMail, simulateur PA verts.
  - **Responsable** : `instance-backend`

- [x] **J2** — Auth API, 2FA, premier lancement poste (connexion instance)
  - **Décision 2026-09-25** : décoché. Validé après redécoupage à la suite d’un refus (§ 4.5) ; le parcours n’a jamais été exécuté dans l’app Tauri. Il repasse devant le contrôleur après la bascule de SDK.
  - **Périmètre** : authentification HTTP (connexion + TOTP + JWKS) et parcours poste **instance → identifiants → TOTP → session enregistrée**. Le scénario produit **S2** complet (ordre d’opération § 3, sync initiale) s’achève au **J3**.
  - **Critères** : `auth_integration` (Postgres réel) ; `tests/recette/s2.mjs` + `j2-demo-migration-parity.mjs` ; OpenAPI auth ; JWT `aud` / JWKS alignés PowerSync (`client_auth` instance) ; UI onboarding sans simulation de téléchargement de données.
  - **Hors périmètre J2** : synchronisation PowerSync bout en bout, probe service `/sync` avec jeton (J3).
  - **Responsable** : `instance-backend` + `poste-interface`

- [x] **J3** — Sync bout en bout (1 table, 2 postes, app Tauri réelle)
  - **Critères** : cahier des charges § 3.4 (cinq points : persistance hors ligne et reprise, fusion par champ, conflit signalé avec journal, ni perte ni doublon, coupure réseau réelle). Recette sur l'app Tauri, SDK `tauri-plugin-powersync`, sans option qui change le comportement de sync.
  - **Écart consigné** : l'app utilisait `@powersync/web` ; correction avant poursuite (voir `JOURNAL.md` 2026-09-25).
  - **Validation 2026-09-25** : contrôleur VALIDÉ sur `86e0856` (CI [36155397731](https://github.com/navelremi-boop/legalos2/actions/runs/36155397731)). `node tests/recette/j3-poste-tauri.mjs` exit 0, cinq critères § 3.4. Écart non bloquant : un `conflit` peut être journalisé sur une écriture séquentielle du même poste après reprise.
  - **Responsable** : état-major coordonne ; `poste-interface` + `instance-backend`

- [x] **J4** — Application Tauri : jetons, police, CI verte
  - **Critères** : `pnpm tauri build` (Windows) ; clippy/ts/eslint verts en CI ; pas de WebDriver en build release.
  - **Validation 2026-09-25** : contrôleur VALIDÉ sur `7871c68` (CI [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952)). `pnpm tauri build` exit 0 (exe, MSI, NSIS). `j4-no-webdriver.mjs --exe` exit 0. Mineurs : pas de fichier OFL à côté des woff2 ; feature `test-webdriver` vide.
  - **Responsable** : `poste-interface`

- [x] **J1–J4** — **Gate phase 1** : contrôleur VALIDÉ avant tout jalon phase 2.
  - **Validation 2026-09-25** : contrôleur VALIDÉ. S1, S2 et sonde PowerSync rejoués (exit 0). CI [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952) et [36166067737](https://github.com/navelremi-boop/legalos2/actions/runs/36166067737) vertes. J3 Tauri non rejoué (pas de doute sur les cinq critères).

---

## Phase 2 — Lots parallèles

- [x] **J5** — Dossiers, contacts, droits (S3, S5)
  - **Validation 2026-09-25** : contrôleur VALIDÉ sur `340ac42` (CI [36172577399](https://github.com/navelremi-boop/legalos2/actions/runs/36172577399)). `j5-poste-tauri.mjs` exit 0 : palette et absence du dossier restreint dans le SQLite du collaborateur.
- [x] **J6** — Agenda et délais (S8, `docs/hypotheses-delais.md`)
  - **Validation 2026-09-25** : contrôleur VALIDÉ sur `bf3bfe3` (CI [36179592258](https://github.com/navelremi-boop/legalos2/actions/runs/36179592258)). `s8-delais.mjs` exit 0. Règles H1–H8 marquées « à valider par l'avocat ». Agenda complet hors périmètre.
- [ ] **J7** — Documents et versions (S6)
  - **Décoché 2026-09-26** : l'écart touche l'invariant § 5.2 (pas d'écrasement silencieux). Un second dépôt du même identifiant peut réécrire un objet déjà scellé. Les métadonnées ne descendent pas vers les postes.
  - **Critères** : l'API refuse toute réécriture d'une version scellée ; écriture conditionnelle côté Garage si le service l'accepte ; métadonnées `documents` et `document_versions` dans les règles PowerSync, avec les mêmes droits que le dossier ; `node tests/recette/s6-documents.mjs` exit 0 ; contrôleur VALIDÉ ; CI verte.
  - Ancien verdict, à reprendre : contrôleur VALIDÉ sur `2eb7266` (CI [36183981852](https://github.com/navelremi-boop/legalos2/actions/runs/36183981852)).
- [ ] **Coque de l'app** — avant la suite de la phase 2 (cahier § 7, version 5)
  - `design/tokens.css` conforme au § 7.3 : couleurs de base, huit chemises à quatre valeurs (fond, teinte, texte, accent), jour et nuit, fond `neutre`, tuile de grain embarquée ; thème shadcn réécrit à partir de ces jetons.
  - Composants du § 7.4 : barre du haut, étiquette avec référence, informations du dossier, jauge d'échéance, feuille, intercalaires standards, barre d'actions flottante. Jour et nuit.
  - Hors dossier : fond `neutre`. La journée selon le § 7.6.
  - Fonctions déjà présentes à leur place : nouveau dossier depuis la palette et la vue Dossiers ; saisie de temps rattachée à un dossier, depuis la barre d'actions et le chronomètre ; calcul de délai depuis la barre d'actions (type choisi dans la bibliothèque, lieu où demeure la partie : métropole, outre-mer, étranger) ; nom du cabinet et thème dans Réglages.
  - Synchronisation invisible : aucun bouton « hors ligne » ou « en ligne ».
  - Galerie de démonstration réservée au développement, absente des builds distribués.
  - Recettes sur des `data-testid` stables. Captures jour et nuit de la vue dossier (trois couleurs de chemise) et de La journée, comparées au prototype par le contrôleur.
- [ ] **Vue scindée** — chrono groupé par période, filtres, aperçu selon le type (mail, pièces, facture, audience, note), badges « définitif » (§ 7.4). Captures comparées au prototype.
- [ ] **Référence de dossier** — § 3.4 : année + numéro remis à zéro chaque année, attribué par le serveur dans une transaction avec unicité ; « référence en attente » hors ligne ; jamais modifiée. Le classement des mails la cherche dans l'objet. Test : deux postes créent en même temps, sans doublon ni trou.
- [ ] **Intercalaires personnalisés** — § 7.4 : table synchronisée, droits du dossier ; rattacher un élément ne le retire pas du chrono ; retirer un intercalaire ne supprime pas son contenu ; les standards ne se retirent pas.
- [ ] **J8** — Temps et facturation électronique (S9)
  - **Dette** (majeur, à solder avant la fin de la phase 2) : fausse alerte de conflit J3 sur une écriture séquentielle du même poste après reprise.
  - **Dette** (à solder dans ce jalon) : `temps_saisis` et `brouillons_facture` sont des tables SQLite hors synchronisation ; la validation crée un dossier ; le taux horaire est une constante. Ils doivent se synchroniser, garder un numéro nul jusqu'à la validation, se rattacher à un dossier existant, et prendre le taux comme paramètre.
- [ ] **J9** — Mail étapes 1–3 (S7 partiel)
- [ ] **J10** — Écrans restants (Mails, Agenda, Facturation, Réglages) selon le § 7.6, après la coque

Chaque jalon : critères = tests recette + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

- [ ] **J11** — Mail étapes 4–5
- [ ] **J12** — Révocation postes (S10)
- [ ] **J13** — Export complet (S12)
- [ ] **J14** — Mises à jour à chaud et distribution (S11, S14a)

---

## Phase 4 — Durcissement et recette

- [ ] **J15** — `cargo xtask recette` S1–S14a en une commande (Windows)
- [ ] **J16** — S14b macOS CI + captures S13 (Playwright jour/nuit)
- [ ] **J17** — Revue sécurité contrôleur, docs installation, `RAPPORT.md`, `.mission/TERMINEE`

---

## Rappel

Un jalon n'est coché que si § 4.4 de l'ordre d'opération est entièrement satisfait (preuves dans `JOURNAL.md`).
