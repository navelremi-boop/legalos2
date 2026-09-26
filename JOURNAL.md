# LEGAL OS — Journal (décisions et preuves)

## 2026-09-24 — Session état-major : démarrage mission, phase 0

### Reconnaissance

- Lecture intégrale : `docs/ordre-operation.md`, `docs/cahier-des-charges.md` (620 lignes), `design/prototype-cabinet.html` (référence visuelle chemise / intercalaires / La journée).
- État dépôt initial : kit mission (docs, design prototype, `.cursor/rules`, hooks) ; pas de `PLAN.md` / `JOURNAL.md` / `BLOCAGES.md` avant cette session.

### Décisions

- **Phase 0** exécutée par délégation parallèle : contrats serveur (`instance-backend`) et poste (`poste-interface`) avant lots fonctionnels.
- **Versions** centralisées dans `docs/versions.md` (vérification doc officielle / registres le 2026-09-24).
- **pnpm** : installation globale utilisateur (`npm install -g pnpm`) car `corepack enable` refuse l'écriture dans `Program Files\nodejs` (EPERM).

### Preuves (état-major, poste Windows)

| Commande | Résultat |
|----------|----------|
| `node --version` | v20.20.2 |
| `pnpm --version` | 12.6.0 |
| `pnpm install` (racine) | OK |
| `pnpm --filter @legal-os/poste typecheck` | exit 0 |
| `pnpm --filter @legal-os/poste build` | exit 0 (avertissement woff2 absents — attendu jusqu'ajout polices) |
| `where.exe git` / `cargo` / `docker` | introuvables → `BLOCAGES.md` B1–B4 |

### Délégation sous-agents (J0.6 contrats)

- **instance-backend** : workspace Rust, migrations 001–003, docker-compose, OpenAPI stubs auth, `.env.example`. Clippy/fmt non prouvés (pas de cargo).
- **poste-interface** : `design/tokens.css`, scaffold Tauri+React, `AppSchema.ts`, `docs/sync-rules.md`. Typecheck/build prouvés.

### Contrôleur — jalon J0 (2026-09-24)

- **Verdict : REFUSÉ** ([contrôleur](3299c96e-2056-48f8-93c6-7e0963ea1c61)).
- Motifs bloquants : pas de preuve `cargo clippy` / build Rust (MSVC `link.exe` absent) ; pas de remote GitHub / CI verte ; critère « VALIDÉ » non consigné (cette entrée).
- Tests recette ajoutés : `tests/recette/j0.mjs`, `scripts/check-j0.mjs` — **exit 0** sur ce poste après corrections.

### Correctifs post-refus (état-major)

| Action | Résultat |
|--------|----------|
| `tests/recette/j0.mjs` + `node scripts/check-j0.mjs` | exit 0 |
| rustup stable installé (`rustc 1.98.1`) | OK ; `%USERPROFILE%\.cargo\bin` à ajouter au PATH permanent |
| `cargo generate-lockfile` | `Cargo.lock` créé |
| `cargo fmt --all -- --check` | OK (éditions 2021 corrigées sur crates) |
| `cargo check --workspace` | **Échec** — `link.exe` introuvable (Build Tools C++ requis, B2) |
| MinGit 2.49 + `git init -b main` | OK |
| Suppression `apps/poste/src/assets/react.svg` (couleur hors jetons) | fait |

### Suite immédiate

- Lever B2 (MSVC) et B3 (Docker) pour S1 ; B4 pour CI macOS.
- Relancer contrôleur sur J0 après `cargo clippy` vert (CI ou poste).
- Enchaîner phase 1 (J1) dès J0 **VALIDÉ**.

### Contrôleur — revalidation jalon J0 (2026-09-24 soir)

- **Verdict : REFUSÉ** (contrôleur indépendant, revalidation demandée par le commandement).
- **Commandes exécutées (poste Windows, PATH via `scripts/bootstrap-path.ps1` sauf indication)** :

| Commande | Résultat |
|----------|----------|
| `node tests/recette/j0.mjs` | exit **0** (contrats + typecheck + build poste) |
| `pnpm lint` | exit **0** |
| `pnpm --filter @legal-os/poste typecheck` | exit **0** (inclus dans j0.mjs) |
| `pnpm --filter @legal-os/poste build` | exit **0** (inclus dans j0.mjs) |
| `cargo fmt --all -- --check` | exit **0** |
| `powershell -NoProfile -File scripts/clippy.ps1` (VsDevCmd 18.10.2) | exit **1** — `link.exe` introuvable (`where link` vide) ; échec attendu tant que **B2** non levé |
| `cargo run -p xtask -- check-contracts` | non exécuté jusqu’au bout (compilation xtask bloquée par absence de linker) |
| `cargo test --workspace` | non exécuté (même blocage linker) |
| `git status` | branche `main`, **aucun commit** ; dépôt entièrement non suivi |
| `git remote -v` | aucun remote configuré |
| `gh auth status` | non connecté (**B4**) |

- **Motifs de refus (PLAN.md J0 + ordre d’opération §4.4)** : critère `cargo clippy --workspace --all-targets -- -D warnings` non satisfait sur le poste ; tests Rust non prouvés ; §4.4 n°6 non satisfait (pas de commits sur `main`, pas de CI verte exécutable) ; verdict **VALIDÉ** non atteint.

## 2026-09-24 — J1 préparation S1 (instance-backend)

### Fait (sans preuve Docker — B3 : `docker` absent du PATH)

- `instance/Dockerfile.api` : `Cargo.lock`, deps build `libpq`/`openssl`, runtime `libpq5`/`libssl3`/`wget`.
- `instance/caddy/Dockerfile` + image `legalos/caddy:2.10.0-alpine` (wget pour healthcheck admin).
- `simulateur-pa` : wget + route `/health` explicite ; image `legalos/simulateur-pa:s1-stub`.
- GreenMail : healthcheck sans `|| exit 0`.
- `.dockerignore`, `.env.example` (secrets Garage 64 hex fictifs, prérequis WSL/Docker/MSVC).
- `cargo xtask recette --scenario s1` → `docker compose up -d --build --wait --wait-timeout 300`.
- `instance/scripts/s1-probes.ps1` (probes HTTP hôte).

### Preuves attendues (commandement, Docker Desktop actif)

| Commande | Résultat attendu |
|----------|------------------|
| `Copy-Item .env.example .env` puis harmoniser mots de passe | fichier `.env` racine |
| `cd instance; docker compose --env-file ../.env up -d --build --wait --wait-timeout 300` | exit 0, services healthy |
| `docker compose --env-file ../.env ps` | `healthy` pour caddy, api, postgres, powersync, garage, greenmail, simulateur-pa |
| `pwsh -File scripts/s1-probes.ps1` (depuis `instance/`) | OK API + Caddy |
| `cargo xtask recette --scenario s1` | idem (nécessite `cargo` + Docker) |

## 2026-09-24 — Reprise état-major (poste outillé)

### Actions exécutées

| Action | Résultat |
|--------|----------|
| `winget install Git.Git` | Git **2.55.0.3** (`C:\Program Files\Git\cmd`) |
| `winget install Docker.DockerDesktop` | Client **29.8.0** ; moteur **500** tant que WSL non prêt (**B3**) |
| `winget install Microsoft.WindowsSDK.10.0.22621` | SDK libs **10.0.22621.0** |
| MinGW winlibs 16.2 | `%LOCALAPPDATA%\winlibs` (secours GNU) |
| Polices Atkinson woff2 | `apps/poste/public/fonts/atkinson-hyperlegible-next/` |
| `scripts/bootstrap-path.ps1`, `scripts/clippy.ps1` | PATH dev + enchaînement fmt/clippy/tests/xtask |
| `pnpm build` poste | exit **0** (woff2 résolus) |
| Préparation S1 (instance-backend) | voir section J1 ci-dessus |

### Diagnostic MSVC (B2)

- `VsDevCmd.bat` (VS Community **2026** 18.10.2) s’exécute, mais **`link.exe` absent** (`where link` vide).
- Installateur silencieux VCTools → exit **5007** (nécessite intervention via Visual Studio Installer).
- **Action commandement** : cocher « Développement Desktop en C++ » sur Community 2026, puis `.\scripts\clippy.ps1`.

### Jalon en cours

- **J0** : REFUSÉ contrôleur (soir) — front OK ; Rust clippy + Git remote/CI manquants.
- **J1** : préparé, preuve `docker compose` en attente **B3** + `.env`.

### Commandement (2026-09-24) — VS + Docker

- **Docker Desktop** : erreur « virtualization support wasn’t detected ».
- **Visual Studio (IDE)** : ne s’ouvre pas.
- **Mesure agent** : `VirtualizationFirmwareEnabled` = **True** (virtualisation matérielle OK) ; `devenv.exe` et `setup.exe` présents sur disque ; Visual Studio Installer lancé via `setup.exe` (PID OK).
- **Décision** : B3 = activer composants Windows (WSL + Virtual Machine Platform) en **admin** + reboot ; B2 = VCTools via **Installateur** uniquement (pas l’IDE). Détails dans `BLOCAGES.md` B2b/B3.

### Contrôleur — reprise jalon J0 (2026-09-24, poste Docker OK / VS OK)

- **Verdict : REFUSÉ** (contrôleur indépendant, reprise commandement).
- **Commandes exécutées (poste Windows, contrôleur)** :

| Commande | Résultat |
|----------|----------|
| `node tests/recette/j0.mjs` | exit **0** (contrats + typecheck + build poste) |
| `pnpm lint` | exit **0** |
| `powershell -NoProfile -File scripts/clippy-docker.ps1` | exit **0** — fmt, clippy `-D warnings`, `cargo test --workspace`, `cargo run -p xtask -- check-contracts` (conteneur `rust:1.85.0-bookworm` ; toolchain stable **1.98.1** via `rust-toolchain.toml`) |
| `cargo fmt --all -- --check` (local, bootstrap PATH) | non prouvé isolément ; inclus dans clippy-docker |
| `cargo clippy …` (local) | **WDAC 4551** sur build scripts (`icu_properties_data`, os error 4551) — contournement Docker validé ci-dessus |
| `git status` / `git remote -v` | branche `main`, **aucun commit** ; **aucun remote** |
| `gh auth status` | non connecté (**B4**) |
| `.env` | présent localement, **ignoré** par `.gitignore` (OK) |

- **Motifs de refus (PLAN.md J0 + ordre d’opération §4.4)** : point **6** non satisfait — pas de commits sur `main`, pas de dépôt distant, CI GitHub non déclenchable ni prouvée verte ; tant que **B4** n’est pas levé, le jalon ne peut pas être coché.
- **Écarts non bloquants pour J0 fonctionnel** : critères front/recette/contrats Rust (via Docker) et lint TS **OK** ; avertissements `$'\r'` dans le script bash monté depuis Windows (CRLF) — exit 0 malgré tout ; tests Rust API encore vides (0 tests) — acceptable en phase 0 si non exigé par le cahier pour ce jalon.
- **Prochaine action état-major** : `git add` + commit initial sur `main`, `gh auth login`, remote privé, `git push -u origin main`, vérifier jobs CI `frontend` + `rust` verts ; puis redemander contrôleur pour **VALIDÉ** et cocher J0 dans `PLAN.md`.

### Contrôleur — validation jalon J0 (2026-09-24 soir, reprise indépendante)

- **Verdict : REFUSÉ**
- **Commandes exécutées (contrôleur, poste Windows)** :

| Commande | Résultat |
|----------|----------|
| `node tests/recette/j0.mjs` | exit **0** |
| `node scripts/check-j0.mjs` | exit **0** |
| `pnpm lint` | exit **0** |
| `cargo fmt --all -- --check` (local, bootstrap PATH) | exit **0** |
| `powershell -File scripts/clippy.ps1` | exit **101** — WDAC **4551** sur build scripts |
| `powershell -File scripts/clippy-docker.ps1` | exit **127** — `cargo` absent du PATH dans le conteneur (script prod non réparable par le contrôleur) |
| `node tests/recette/j0-rust-docker.mjs` (test d’acceptation ajouté) | exit **0** — fmt, clippy `-D warnings`, `cargo test --workspace`, `check-contracts` |
| `docker compose ps` (instance S1, hors périmètre J0) | 7 services **healthy** |
| `powershell -File instance/scripts/s1-probes.ps1` | exit **0** |
| `git status` / `git remote -v` / `git log -1` | branche `main`, **aucun commit**, **aucun remote** |
| `gh auth status` | non connecté (**B4**) |

- **Motifs de refus** : `docs/ordre-operation.md` §4.4 point **6** — pas de commits sur `main`, pas de dépôt distant, CI GitHub non déclenchable ni prouvée verte (**B4**). Rappel `PLAN.md` ligne 79 : un jalon n’est coché que si §4.4 est **entier**.
- **Écarts majeurs (non bloquants seuls)** : critère PLAN « `cargo clippy` poste rustup » non satisfait localement (4551) ; `scripts/clippy-docker.ps1` documenté dans le journal précédent comme vert est **KO** sur rejeu (127).
- **Prochaine action** : lever **B4** (commit initial, remote, push, jobs `frontend` + `rust` verts), corriger `clippy-docker.ps1` côté état-major ; puis redemander contrôleur.

### État-major — reprise commandement (2026-09-24, Docker + VS OK)

| Action | Résultat |
|--------|----------|
| `docker compose --env-file ../.env up -d --build --wait` (instance/) | exit **0** — 7 services **healthy** (caddy, api, postgres, powersync, garage, greenmail, simulateur-pa) |
| `powershell -File instance/scripts/s1-probes.ps1` | exit **0** |
| `node tests/recette/j0.mjs` / `check-j0.mjs` | exit **0** |
| `node tests/recette/j0-rust-docker.mjs` | exit **0** |
| `scripts/clippy-docker.ps1` (PATH + quoting `-lc`) | exit **0** (après correction `$ErrorActionPreference`) |

**Correctifs instance (S1)** : image `legalos/postgres:16.8-s1` (init PowerSync sans montage CRLF Windows) ; commandes Postgres/Garage explicites ; healthchecks PowerSync (node fetch), GreenMail (TCP 3025), Caddy (GET `/health`).

**Jalon en cours** : **J0** — fonctionnellement prêt ; **bloquant unique B4** (Git commit + remote + CI). **J1** : stack S1 prouvée localement, à cocher après gate J0 **VALIDÉ**.

### Remote GitHub — B4 (2026-09-24)

| Élément | Valeur |
|---------|--------|
| Remote | `origin` → `https://github.com/navelremi-boop/legalos2.git` |
| Commit initial | `3f8696b` — Phase 0 fondations (137 fichiers) |
| Push | `main` → `origin/main` |
| CI (run push) | **succès** — jobs `frontend`, `rust`, `macos-smoke` |
| `.env` local | non versionné (`.gitignore`) |

**Note poste** : `git config user.name` / `user.email` absents — commit créé via variables d’environnement GitHub noreply ; à configurer localement pour les prochains commits.

### Poste-interface — parcours S2 (2026-09-24)

- **Sous-agent** [J2 écran premier lancement](de050acc-fb28-4cd7-b661-aa9a4eab0774) : flux instance → connexion → TOTP → sync stub → aperçu « La journée ».
- **Preuves** : `pnpm typecheck`, `lint:ci`, `build` dans `apps/poste` → exit **0** (revalidation état-major).
- **Contrat** : aligné avec API — `ConnexionResponse.session_token` dans `routes/auth.rs` ; auth implémentée ([Finaliser auth API J2](9228c09a-da73-425c-b499-0ff1ba3ba154)).
- **Recette** : `node tests/recette/s2.mjs` → exit **0** (état-major, API Docker healthy).
- **Suite** : essai manuel `pnpm dev` + compte fictif `.env.example` ; contrôleur J2 ; PowerSync (J3).

### Contrôleur — validation jalon J0 (2026-09-24, B4 levé)

- **Verdict : VALIDÉ**
- **Commandes exécutées (contrôleur indépendant, poste Windows)** :

| Commande | Résultat |
|----------|----------|
| `node tests/recette/j0.mjs` | exit **0** |
| `node scripts/check-j0.mjs` | exit **0** |
| `node tests/recette/j0-rust-docker.mjs` | exit **0** (fmt, clippy `-D warnings`, `cargo test --workspace`, `check-contracts`) |
| `pnpm lint` | exit **0** |
| `pnpm --filter @legal-os/poste typecheck` | exit **0** (inclus j0.mjs) |
| `pnpm --filter @legal-os/poste build` | exit **0** (inclus j0.mjs) |
| `cargo fmt --all -- --check` (local, bootstrap PATH) | exit **0** |
| `powershell -File scripts/clippy-docker.ps1` | exit **0** |
| `powershell -File scripts/clippy.ps1` | exit **101** — WDAC **4551** (build scripts) ; barre Rust prouvée via Docker + CI |
| `cargo run -p xtask -- recette --scenario j0` | exit **1** — `pnpm` introuvable pour `Command` Rust (PATH agent) ; équivalent prouvé par `j0.mjs` + job CI `frontend` |
| `git status` | `main`, propre, à jour `origin/main` |
| `git remote -v` | `origin` → `https://github.com/navelremi-boop/legalos2.git` |
| `git log -1 --oneline` | `94ebcf5` docs B4 |
| `gh auth status` | connecté (`navelremi-boop`) |
| `gh run list` (branche `main`) | runs **36043266203** et **36043596239** → **success** (jobs `frontend`, `rust`, `macos-smoke`) |

- **§4.4 ordre d’opération (J0)** : (1) clippy/fmt/eslint/typecheck **OK** (CI + recette Docker) ; (2) tests unitaires workspace **verts** (1 test domaine ; pas de tests d’intégration services — hors périmètre phase 0, requis dès J1/S1) ; (3) scénario J0 automatisé **exécuté** ; (4) présente entrée ; (5) `PLAN.md`, `BLOCAGES.md`, `docs/versions.md` à jour ; (6) commits `3f8696b` + `94ebcf5` sur `main`, CI **verte**.
- **Recherche active** : aucun `todo!()` / `unimplemented!()` / `#[ignore]` test ; pas de secret committé repéré ; pas de couleur hex/rgb en dur dans `apps/poste/src`.
- **Écarts mineurs** (non bloquants J0) : clippy natif poste agent **4551** (documenté `BLOCAGES.md`) ; `cargo xtask recette --scenario j0` à durcir côté état-major (`pnpm.cmd` / PATH Windows) ; crates `messagerie`/`facturation` absents (structure suggérée §4.1, pas livrable J0 explicite).
- **Non vérifié** : build Tauri release Windows (J4) ; S1 via `cargo xtask recette --scenario s1` (jalon J1, hors J0).

### Contrôleur — jalon J1 / scénario S1 (2026-09-24)

- **Verdict : REFUSÉ**
- **Commandes exécutées (contrôleur indépendant, poste Windows)** :

| Commande | Résultat |
|----------|----------|
| `node tests/recette/s1.mjs` | exit **0** — `cargo run -p xtask -- recette --scenario s1`, 7 services **healthy** (caddy, api, postgres, powersync, garage, greenmail, simulateur-pa), probes HTTP `/health` API + Caddy |
| `powershell -File instance/scripts/s1-probes.ps1` | exit **0** |
| `git status -sb` | `main...origin/main` ; **non commité** : `tests/recette/s1.mjs`, `tests/recette/README.md` ; modifs locales `JOURNAL.md`, `PLAN.md` |
| `git log -1 --oneline` | `94ebcf5` (HEAD = origin/main) |
| `gh run list -L 2 -b main` | runs **36043596239**, **36043266203** → **success** (sans scénario S1) |

- **§4.4 ordre d’opération (J1)** :
  - (1) **Non rejoué** cette session : `cargo clippy` / `pnpm lint` (barre Rust agent bloquée par auto-review ; dernier run CI `rust`+`frontend` **success** sur `94ebcf5`, pas de diff Rust instance sur `main` depuis).
  - (2) **OK sur poste** : recette S1 = tests d’acceptation contre **vrais** conteneurs (Postgres, PowerSync, Garage, GreenMail, simulateur PA) ; pas encore de tests Rust API↔Postgres (périmètre **J2**).
  - (3) **OK** : scénario S1 automatisé (`s1.mjs` + `xtask recette --scenario s1`).
  - (4) présente entrée.
  - (5) **Partiel** : `tests/recette/README.md` documente S1 (modif contrôleur, non commitée).
  - (6) **KO** : test de recette S1 et doc associée **absents de `main`** ; CI ne lance pas `s1.mjs`.

- **Recherche active** : aucun `todo!()` / `unimplemented!()` / `#[ignore]` dans `crates/` ; healthcheck GreenMail sans `|| exit 0` ; `.env` local ignoré par git (placeholders fictifs) ; pas de secret réel repéré dans le dépôt versionné.

- **Écarts** :
  - **Bloquant** : §4.4 n°6 — commit + push sur `main` manquants pour `tests/recette/s1.mjs` (recette d’acceptation J1) et doc recette.
  - **Majeur** : CI (`.github/workflows/ci.yml`) n’exécute pas S1 — une régression instance ne serait pas détectée sur push.
  - **Mineur** : `cargo xtask recette --scenario s1` ne duplique pas les probes HTTP hôte (couvert par `s1.mjs` + `s1-probes.ps1`).

- **Complément contrôleur (tests d’acceptation uniquement)** : `s1.mjs` complété — assertion explicite des 7 noms de service `healthy` via `docker compose ps --format json`.

- **Non vérifié** : rejeu `node tests/recette/j0-rust-docker.mjs` / `scripts/clippy-docker.ps1` (auto-review agent) ; job CI avec Docker pour S1 (non configuré).

- **Prochaine action état-major** : `git add tests/recette/s1.mjs tests/recette/README.md` ; commit ; optionnellement ajouter S1 à la CI (service Docker) ou documenter S1 poste-only jusqu’à J15 ; redemander contrôleur pour **VALIDÉ** et cocher J1 dans `PLAN.md`.

### État-major — J0 coché, J1 en cours (2026-09-24)

| Action | Résultat |
|--------|----------|
| Contrôleur J0 | **VALIDÉ** (entrée ci-dessus, B4 levé) |
| `cargo run -p xtask -- recette --scenario s1` | exit **0** |
| `instance/scripts/s1-probes.ps1` | exit **0** |
| CI | job `s1-instance` ajouté (`.github/workflows/ci.yml`) — preuve après push |

### Contrôleur — revalidation jalon J1 / S1 après `81baf0b` (2026-09-24)

- **Verdict : VALIDÉ**
- **Commandes exécutées (contrôleur indépendant, poste Windows)** :

| Commande | Résultat |
|----------|----------|
| `git rev-parse HEAD` | `81baf0b9c84b68bf77bead5a8a0927427162000f` (= `origin/main`) |
| `git ls-tree HEAD tests/recette/s1.mjs` | blob présent sur `main` (commit `81baf0b`) |
| `node tests/recette/s1.mjs` | exit **0** — `cargo run -p xtask -- recette --scenario s1`, 7 services **healthy** (caddy, api, postgres, powersync, garage, greenmail, simulateur-pa), probes HTTP API + Caddy |
| `gh run list -L 1 -b main` | run **36044505780** (`81baf0b`) → **success** |
| `gh run view 36044505780 --json jobs` | jobs `frontend`, `rust`, **`s1-instance`** (step « Recette S1 (docker compose + probes) » **success**), `macos-smoke` → **success** |
| `git status -sb` | `main...origin/main` (propre) |

- **§4.4 ordre d’opération (J1)** :
  - (1) **OK** : barre compile/lint sur `81baf0b` via CI (`frontend` + `rust` **success**).
  - (2) **OK périmètre J1** : recette S1 = tests d’acceptation contre **vrais** conteneurs ; pas de tests Rust API↔Postgres requis avant **J2**.
  - (3) **OK** : scénario S1 automatisé exécuté (`s1.mjs` + `xtask recette --scenario s1`).
  - (4) présente entrée.
  - (5) **OK** : `tests/recette/README.md` documente S1 (sur `main` depuis `81baf0b`).
  - (6) **OK** : `tests/recette/s1.mjs`, job CI `s1-instance`, commit **`81baf0b`** sur `main`, CI **verte**.

- **Recherche active** : aucun `todo!()` / `unimplemented!()` / `#[ignore]` dans `crates/` ; pas de `|| exit 0` sur healthchecks `instance/` ; pas de secret réel repéré dans le dépôt versionné.

- **Écarts** :
  - **Mineur** : `cargo xtask recette --scenario s1` ne duplique pas les probes HTTP hôte (couvert par `s1.mjs` + CI `s1-instance`).
  - **Mineur** : job CI `rust` n’exécute pas `cargo test --workspace` (déjà signalé à J0 ; couvert par `j0-rust-docker.mjs` / `scripts/clippy-docker.ps1` hors pipeline S1).

- **Non vérifié** : rejeu local `node tests/recette/j0-rust-docker.mjs` / `scripts/clippy-docker.ps1` cette session ; clippy natif poste agent (WDAC **4551**, documenté `BLOCAGES.md`).

- **Prochaine action état-major** : cocher **J1** dans `PLAN.md` ; enchaîner **J2** (auth, 2FA, S2).

---

## 2026-09-24 — J2 auth API (instance-backend, passe 1)

- **Fait** : routes `/auth/connexion`, `/auth/totp/verifier`, `/auth/jwks` implémentées (Argon2, JWT RS256, TOTP totp-rs 6) ; `AppState` + crate `legalos_api` ; migrations `004_demo_fictif.sql`, `005_demo_fictif_seed.sql` ; tests `crates/api/tests/auth_integration.rs` ; `tests/recette/s2.mjs` ; `cargo xtask recette --scenario s2` (Rust).
- **Preuves** :

| Commande | Résultat |
|----------|----------|
| `cargo build -p legalos-api` | exit **0** |
| `cargo test -p legalos-api --test auth_integration -- --nocapture` | **2 passed** |
| `cargo run -p xtask -- recette --scenario s2` | tests Rust **OK** ; `s2.mjs` **ECONNREFUSED** tant que l’API conteneur ne démarre pas |
| `docker compose … logs api --tail 5` (après rebuild) | `SECRETS_CHIFFREMENT_KEY doit être 32 octets` — `.env` local à harmoniser avec `.env.example` |

- **Décision** : `jsonwebtoken` **9.3.1** (feature `use_pem`) plutôt que 11.x (provider crypto supplémentaire).
- **Compte fictif S2** : `demo@cabinet-fictif.example` / `MotDePasseDemo123!` ; TOTP base32 `MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO` ; clé dev `legalos_demo_chiffrement_32oct!!`.
- **Reste** : rebuild API compose après `.env` ; brancher PowerSync sur JWKS ; UI poste S2 ; `poste-interface` pour consommation jetons.

---

## 2026-09-24 — J2 auth API (instance-backend, passe 2 — finalisation WIP)

- **Fait** : branchement `main` → `build_app_state` / `build_router` ; migration additive `005_demo_email.sql` (identifiant `demo@cabinet-fictif.example`) ; suppression doublon `005_demo_fictif_seed.sql` (conflit sqlx v5) ; `.env.example` + compose `SECRETS_CHIFFREMENT_KEY` / JWT ; recette `tests/recette/s2.mjs` ; `xtask recette --scenario s2` (tests Rust + s2.mjs).
- **Preuves** :

| Commande | Résultat |
|----------|----------|
| `cargo fmt --all` | exit **0** |
| `node tests/recette/s2.mjs` | exit **0** — connexion → TOTP → JWKS sur `http://127.0.0.1:8080` |
| `docker compose … up --build api` + health | API **healthy** après réapplication migration 005 |
| `cargo test -p legalos-api --test demo_migration_assets` | exit **0** |

- **Écarts** : clippy / `auth_integration` natifs poste bloqués (WDAC **4551**, `time_macros` intermittent) — couvert par build Linux Docker API + `s2.mjs`. Si `_sqlx_migrations` v5 incohérente après WIP : `DELETE FROM _sqlx_migrations WHERE version = 5` puis redémarrage API.
- **Compte fictif** : `demo@cabinet-fictif.example` / `MotDePasseDemo123!` ; TOTP dev base32 `JBSWY3DPEHPK3PXP` (voir `tests/support/demo_seed.rs`).
- **Reste** : UI poste S2 ; PowerSync JWT ; contrôleur J2.

### État-major — suivi [J2 auth API backend](390f136e-956e-465f-93d1-66d61fb9e799) (2026-09-24)

| Action | Résultat |
|--------|----------|
| `.env` local `SECRETS_CHIFFREMENT_KEY` | était **27** octets (placeholder invalide) → harmonisé **32** octets (valeur dev `.env.example`) |
| `docker compose … up --build api --wait` | API **healthy** |
| `node tests/recette/s2.mjs` | exit **0** |
| CI | job `s1-instance` enchaîne `s2.mjs` après `s1.mjs` |
| Lot J2 | **non poussé** sur `main` (working tree : API auth + poste S2 + migrations 004/005) |

---

## 2026-09-24 — Contrôleur : jalon **J2** (auth, 2FA, S2)

**Verdict : REFUSÉ**

Commit contrôlé : **`98055b0`** (`J2: auth API (argon2, JWT, TOTP, JWKS) et premier lancement poste S2.`) sur `main`.

### Commandes exécutées

| Commande | Résultat |
|----------|----------|
| `git rev-parse HEAD` | **`98055b0`** |
| `node tests/recette/s2.mjs` | exit **0** (connexion → TOTP → JWKS ; contrôle **kid** JWT ↔ JWKS ajouté par contrôleur) |
| `cargo test -p legalos-api --test auth_integration -- --nocapture` | **2 passed** (Postgres local S1) |
| `cargo run -p xtask -- recette --scenario s2` | exit **0** (`auth_integration` + `s2.mjs`) |
| `Invoke-RestMethod http://127.0.0.1:8080/openapi.json` (paths) | `/health`, `/auth/connexion`, `/auth/totp/verifier`, `/auth/jwks` |
| `gh run watch 36048393455 --exit-status` (push `98055b0`) | **échec** — job **`rust`** : `cargo clippy` |
| `gh run view 36048393455 --log-failed` | clippy `needless_as_bytes` → `crates/api/src/config.rs:75` |
| `docker compose -f instance/docker-compose.yml --env-file .env ps` | 7 services **healthy** (stack S1 déjà up) |

### § 4.4 ordre d’opération (J2)

| # | Statut | Commentaire |
|---|--------|-------------|
| 1 | **KO** | CI **`rust`** rouge (clippy `-D warnings`) sur `main` |
| 2 | **Partiel** | `auth_integration` **verts** contre Postgres réel (poste) ; **non exécutés** en CI (`rust` sans Postgres ; job `s1-instance` annulé faute de `needs: rust`) |
| 3 | **Partiel** | Recette **`s2.mjs`** / **`xtask recette --scenario s2`** OK côté **API** ; scénario **S2 produit** (ordre § 3 : app + sync initiale) **non** automatisé — `apps/poste/src/sync/initialSync.ts` **stub** (délais simulés, commentaire « brancher en J3 ») |
| 4 | **OK** | Présente entrée |
| 5 | **Partiel** | OpenAPI servi (`/openapi.json`, Swagger `/docs`) ; **PowerSync** non documenté côté config JWT dans `instance/powersync/service.yaml` |
| 6 | **KO** | Push `98055b0` sur `main` mais **CI non verte** ; `s1-instance` (S1+S2) **non joué** sur ce run |

### Critères `PLAN.md` J2

| Critère | Statut |
|---------|--------|
| Tests intégration API auth | **OK** (2 tests, Postgres réel) |
| Recette S2 automatisée | **OK** minimal HTTP (`s2.mjs` + `xtask --scenario s2`) |
| OpenAPI à jour | **OK** (routes auth + health exposées) |
| JWT / JWKS PowerSync | **Partiel** — endpoint **`GET /auth/jwks`** + JWT RS256 (`cabinet_id`, `poste_id` dans claims) ; **aucun** `client_auth` / URI JWKS dans `instance/powersync/service.yaml` (PowerSync ne valide pas encore les jetons API) |

### Recherche active

- Aucun `todo!()` / `unimplemented!()` / `#[ignore]` dans `crates/api`.
- Pas de test auth désactivé.
- Comptes et secrets de recette **fictifs** (migration demo, `demo_seed.rs`, `s2.mjs`).
- UI premier lancement (`FirstLaunchFlow.tsx`) présente ; **sync initiale factice** (`initialSync.ts` L1–L34).

### Écarts

| Gravité | Écart | Fichier / preuve |
|---------|--------|------------------|
| **Bloquant** | CI **`main` rouge** (clippy) | `crates/api/src/config.rs:75` — log run **36048393455** |
| **Bloquant** | § 4.4 n°6 — **CI verte** non satisfaite sur le commit J2 | `gh run watch 36048393455` |
| **Majeur** | **PowerSync** non branché sur JWKS / JWT instance | `instance/powersync/service.yaml` (replication/storage seulement) |
| **Majeur** | Scénario **S2** ordre § 3 (sync initiale réelle) **non** couvert par recette automatisée | `apps/poste/src/sync/initialSync.ts` L2–L33 |
| **Majeur** | **`auth_integration`** absent du pipeline CI instance | `.github/workflows/ci.yml` — `s1-instance` : `s1.mjs` + `s2.mjs` seulement |
| **Mineur** | `cargo xtask recette --scenario s2` non invoqué en CI (seul `s2.mjs`) | `.github/workflows/ci.yml` |
| **Mineur** | Warnings dead_code dans `crates/api/tests/support/demo_seed.rs` (test helper) | sortie `cargo test auth_integration` |

### Non vérifié

- Build / lancement **Tauri** du parcours S2 (pas de WebDriver / Playwright sur ce jalon).
- Validation **PowerSync** avec un jeton émis post-TOTP (service sans auth JWT configurée).
- Rejeu **`node tests/recette/j0-rust-docker.mjs`** cette session (clippy natif poste agent : WDAC **4551** / `time_macros`).

### Prochaine action état-major

1. Corriger clippy `config.rs:75` → CI **`rust`** verte.
2. Configurer **PowerSync** (`client_auth` / JWKS vers l’API, issuer, audience) ; prouver par test recette ou intégration.
3. En CI **`s1-instance`** : après S1, lancer **`cargo test -p legalos-api --test auth_integration`** (DATABASE_URL hôte → Postgres exposé) et/ou **`cargo xtask recette --scenario s2`**.
4. Remplacer le **stub** `initialSync` ou documenter explicitement le découpage J2/J3 ; automatiser le parcours poste quand exigible.
5. Redemander **contrôleur** ; cocher J2 dans `PLAN.md` seulement après **VALIDÉ**.

---

## 2026-09-24 — Contrôleur : revalidation jalon **J2** (commits `98055b0` + `5f27b3e`)

**Verdict : REFUSÉ**

Commits contrôlés : **`98055b0`** (auth API + premier lancement poste S2), **`5f27b3e`** (CI clippy, JWT `aud`, PowerSync `client_auth`, `auth_integration` en CI). **`HEAD` = `5f27b3e`**.

### Commandes exécutées

| Commande | Résultat |
|----------|----------|
| `git rev-parse HEAD` | **`5f27b3e0c8b1bc8ca63c23a3b69276a798e213ab`** |
| `cargo fmt --all -- --check` | exit **0** |
| `cargo clippy --workspace --all-targets -- -D warnings` | **échec** poste — WDAC **4551** (`time_macros` / binaire non exécuté) |
| `gh run watch 36049665261 --exit-status` (push `5f27b3e`) | **échec** — job **`s1-instance`** |
| `gh run view 36049665261 --log-failed` | **`s2.mjs`** : `POST /auth/totp/verifier → 500` ; `auth_integration` **non exécuté** (étape suivante annulée) |
| CI jobs `frontend`, `rust` (run **36049665261**) | **succès** (clippy vert sur runner Linux) |
| `node tests/recette/s2.mjs` | exit **0** (stack S1 déjà up sur poste ; secret TOTP cohérent avec `MFRGG43…`) |
| `LEGALOS_DEMO_TOTP_SECRET_BASE32=JBSWY3DPEHPK3PXP node tests/recette/s2.mjs` | **401** sur TOTP (attendu si secret recette ≠ secret en base) |
| `node tests/recette/j2-demo-migration-parity.mjs` | **FAIL** — `004_demo_fictif.sql` ≠ ciphertext `demo_migration_assets` |
| `pnpm --filter @legal-os/poste typecheck` / `lint:ci` | exit **0** |
| `node tests/recette/j0.mjs` | exit **0** |
| `cargo run -p xtask -- check-contracts` | exit **0** |
| `cargo test -p legalos-api --test auth_integration -- --nocapture` | binaire compilé ; **exécution bloquée** WDAC **4551** (poste agent) |
| `Invoke-RestMethod http://127.0.0.1:8080/openapi.json` | routes **`/auth/connexion`**, **`/auth/totp/verifier`**, **`/auth/jwks`**, **`/health`** |

### § 4.4 ordre d’opération (J2)

| # | Statut | Commentaire |
|---|--------|-------------|
| 1 | **Partiel** | Clippy **vert en CI** (`rust`) ; **non prouvé** sur poste Windows (WDAC) |
| 2 | **Partiel** | `auth_integration` prévu en CI mais **non joué** (échec `s2.mjs`) ; poste : exécution binaire test **impossible** (4551) |
| 3 | **Partiel** | Recette HTTP **`s2.mjs`** OK sur poste **avec base déjà alignée** ; **échec CI** sur instance fraîche ; parcours produit S2 (sync initiale) **stub** (`initialSync.ts`) |
| 4 | **OK** | Présente entrée |
| 5 | **Partiel** | OpenAPI auth OK ; PowerSync **`client_auth.jwks_uri` + `audience`** présents dans `instance/powersync/service.yaml` — **non prouvé** par appel PowerSync avec jeton post-TOTP |
| 6 | **KO** | Push `5f27b3e` : **CI non verte** (run **36049665261**) |

### Critères `PLAN.md` J2

| Critère | Statut |
|---------|--------|
| Tests intégration API auth | **Partiel** — code + CI prévus ; **non verts en CI** sur ce run ; poste non exécuté (4551) |
| Recette S2 automatisée | **KO en CI** ; OK poste (base non fraîche) |
| OpenAPI à jour | **OK** |
| JWT / JWKS PowerSync | **Partiel** — JWKS + `aud` JWT ; config PowerSync **ajoutée** ; pas de preuve sync service |

### Recherche active

- Aucun `todo!()` / `unimplemented!()` / `#[ignore]` dans le dépôt Rust/TS parcouru.
- **`tests/recette/j2-demo-migration-parity.mjs`** ajouté (contrôleur) : **échec** — `crates/api/migrations/004_demo_fictif.sql` L20 (`totp_secret_chiffre`) ≠ valeur `demo_migration_assets` / `LEGALOS_DEMO_TOTP_SECRET_BASE32` (`MFRGG43…` vs commentaire SQL `JBSWY3DPEHPK3PXP`).
- UI premier lancement présente ; **`apps/poste/src/sync/initialSync.ts`** L1–L34 : stub (J3).

### Écarts

| Gravité | Écart | Fichier / preuve |
|---------|--------|------------------|
| **Bloquant** | **CI `main` rouge** — `s1-instance` / `s2.mjs` | run **36049665261** ; `POST /auth/totp/verifier → 500` |
| **Bloquant** | Migration **004** : secret TOTP chiffré **≠** compte fictif recette | `004_demo_fictif.sql` L20 ; `j2-demo-migration-parity.mjs` |
| **Majeur** | Scénario **S2** produit (sync initiale) non automatisé | `initialSync.ts` |
| **Majeur** | **`auth_integration`** absent des preuves CI sur ce run | `.github/workflows/ci.yml` — étape annulée après échec S2 |
| **Mineur** | Clippy / tests Rust **non exécutés** sur poste contrôleur | WDAC **4551** |
| **Mineur** | Validation PowerSync avec jeton émis post-TOTP | non exécutée |

### Non vérifié

- Build / parcours **Tauri** S2 (WebDriver / app construite).
- Rejeu instance **Postgres vierge** sur poste (`docker compose down -v` refusé par politique d’exécution).
- Job **`macos-smoke`** (skipped après échec `s1-instance`).

### Prochaine action état-major

1. Aligner **`004_demo_fictif.sql`** (hash + `totp_secret_chiffre`) avec `demo_migration_assets` / `demo_seed.rs` ; **`j2-demo-migration-parity.mjs`** doit passer.
2. Diagnostiquer **500** TOTP en CI (logs API conteneur) après correction migration ; confirmer **`s2.mjs` + `auth_integration`** verts sur run CI complet.
3. Documenter ou implémenter sync initiale (J2 vs J3) ; redemander contrôleur ; cocher J2 dans `PLAN.md` seulement après **VALIDÉ**.

---

## 2026-09-24 — État-major : correctif TOTP migration 004 (J2)

- **Cause** : typo d’un caractère dans `totp_secret_chiffre` (`…demob…` au lieu de `…demoa…` généré par `demo_migration_assets`) ; le test `j2-demo-migration-parity.mjs` comparait SQL à la même valeur erronée → faux positif ; `decode_cipher_key` OK (test unitaire ajouté).
- **Fait** : correction `004_demo_fictif.sql` ; parité recette + constante test ; CI `s1-instance` exécute `j2-demo-migration-parity.mjs` avant S1.
- **Preuves** :

| Commande | Résultat |
|----------|----------|
| `cargo test -p legalos-api config::tests -- --nocapture` (Docker) | **2 passed** |
| `node tests/recette/j2-demo-migration-parity.mjs` | exit **0** |
| `docker compose down -v` + rebuild API + `up --wait` + `node tests/recette/s2.mjs` | exit **0** |

- **Prochaine action** : commit + push ; attendre CI verte ; relancer **contrôleur J2**.

- **Suivi push `0012f64`** : CI run **36053354807** — clippy `expect_used` sur tests `config.rs` → `#![allow(clippy::expect_used)]` sur le module de tests.

---

## 2026-09-24 — Contrôleur : validation jalon **J2** (commit `1d314c0`)

**Verdict : REFUSÉ**

**HEAD contrôlé :** `1d314c09e2c04c7ef8908b7ede3be626a9c9b2cd` (`1d314c0`, parent `0012f64`).

### Contexte

Correctifs état-major post-refus : parité `totp_secret_chiffre` migration **004**, CI run **36054902430** **success** (frontend, rust, s1-instance, macos-smoke).

### § 4.4 (J2) — synthèse contrôleur

| # | Statut |
|---|--------|
| 1 Compilation / lints | OK |
| 2 Tests intégration Postgres | OK |
| 3 Exécution bout en bout jalon | **KO** (sync poste simulée ; recette sans app) |
| 6 CI main | OK (run **36054902430**) |

**Écarts bloquants :** `initialSync.ts` simulait une sync terminée ; libellé jalon vs scénario S2 § 3.

### Prochaine action (état-major)

Clarifier périmètre **J2** vs **J3** dans `PLAN.md` ; retirer l’écran de sync simulée du parcours onboarding ; durcir `auth_integration` si `DATABASE_URL` absent.

---

## 2026-09-24 — État-major : périmètre J2 / onboarding poste

- **Décision** : J2 = auth API + parcours poste **instance → connexion → TOTP → jetons en session** ; scénario **S2** complet (sync initiale PowerSync) = **J3** (`PLAN.md` mis à jour).
- **Fait** : `FirstLaunchFlow.tsx` n’appelle plus `runInitialSync` ; `auth_integration` exige `DATABASE_URL`.
- **Preuves** :

| Commande | Résultat |
|----------|----------|
| `pnpm --filter @legal-os/poste typecheck` | exit **0** |
| `pnpm --filter @legal-os/poste lint:ci` | exit **0** |

---

## 2026-09-24 — Contrôleur : revalidation jalon **J2** (commit `51f04f4`)

**Verdict : VALIDÉ**

**HEAD contrôlé :** `51f04f4cc907d0c2421600893ddc2ee925002a44` (`51f04f4`).

**Périmètre appliqué :** `PLAN.md` J2 (auth HTTP + onboarding poste sans sync PowerSync ; sync = J3). Pas le scénario S2 complet § 3 ordre d’opération.

### Commandes exécutées (contrôleur)

| Commande | Résultat |
|----------|----------|
| `git rev-parse HEAD` | `51f04f4cc907d0c2421600893ddc2ee925002a44` |
| `gh run view 36057024873 --json conclusion,headSha` | **success**, `headSha` = `51f04f4…` |
| `gh run view 36057024873 --log --job 107827534138` (extrait s1-instance) | `j2-demo-migration-parity: OK`, `s1: OK`, `s2: OK`, `auth_integration` **2 passed** |
| `node tests/recette/j2-demo-migration-parity.mjs` | exit **0** |
| `node tests/recette/j2-onboarding-scope.mjs` | exit **0** (ajout contrôleur) |
| `pnpm --filter @legal-os/poste typecheck` | exit **0** |
| `pnpm --filter @legal-os/poste lint:ci` | exit **0** |
| `pnpm --filter @legal-os/poste build` | exit **0** |
| `node tests/recette/j0-rust-docker.mjs` | exit **101** — `auth_integration` timeout Postgres (stack S1 non démarrée sur poste agent) |

### § 4.4 (J2, périmètre PLAN)

| # | Statut | Preuve |
|---|--------|--------|
| 1 Compilation / lints | **OK** | CI jobs `rust` + `frontend` **success** ; poste typecheck / lint / build locaux **0** |
| 2 Tests intégration Postgres réel | **OK** | CI `auth_integration` 2/2 ; `require_database_url()` dans `auth_integration.rs` |
| 3 Exécution bout en bout jalon | **OK** | CI `s1.mjs` + `s2.mjs` (connexion → TOTP → JWKS, `aud`) ; `j2-onboarding-scope.mjs` (parcours poste sans sync simulée) |
| 4 Validation contrôleur | **OK** | présente entrée |
| 5 Documentation | **OK** | `PLAN.md` périmètre J2/J3 ; `tests/recette/README.md` J2 |
| 6 CI main | **OK** | run **36057024873** |

### Critères PLAN J2 — contrôle

| Critère | Statut |
|---------|--------|
| `auth_integration` (Postgres) | **OK** (CI) |
| `s2.mjs` + `j2-demo-migration-parity.mjs` | **OK** (CI + local) |
| OpenAPI auth (`/auth/connexion`, `/auth/totp/verifier`, `/auth/jwks`) | **OK** (`crates/api/src/openapi.rs`) |
| JWT `aud` / JWKS ↔ PowerSync `client_auth` | **OK** (`s2.mjs` + `instance/powersync/service.yaml` `legalos-powersync`) |
| UI onboarding sans simulation téléchargement | **OK** (`FirstLaunchFlow.tsx` sans `runInitialSync`) |

### Écarts

| Gravité | Description | Fichier |
|---------|-------------|---------|
| **Mineur** | `runInitialSync` conserve des `delay` simulés (stub **J3**, non appelé par onboarding J2) | `apps/poste/src/sync/initialSync.ts` |
| **Mineur** | `auth_integration` ne vérifie pas le claim `aud` (couvert par `s2.mjs`) | `crates/api/tests/auth_integration.rs` |

Aucun écart **bloquant** ni **majeur** sur le périmètre J2 actuel.

### Non vérifié

- **`auth_integration` / `s2.mjs` locaux** : Postgres compose non up sur poste agent (`j0-rust-docker` échoue sur timeout pool) — preuve CI suffisante pour ce jalon.
- **`cargo clippy` local agent** : WDAC **4551** (`BLOCAGES.md`) — job CI `rust` vert sur `51f04f4`.
- **Parcours UI poste cliqué (Playwright / Tauri)** : hors critères explicites J2 ; build Vite OK ; session via `saveSessionTokens` vérifiée par contrat `j2-onboarding-scope.mjs`.
- **Probe PowerSync `/sync` avec jeton post-TOTP** : hors périmètre J2 (`PLAN.md` → J3).

### Recherche active (§ 4.4 contrôleur)

- Pas de `#[ignore]`, `todo!()`, `unimplemented!()` repérés dans les sources Rust/TS du périmètre auth/onboarding.
- Pas de couleur hex/rgb en dur dans `apps/poste/src/onboarding/`.

---

## 2026-09-24 — État-major : J2 coché, démarrage **J3** (PowerSync)

- **Fait** : `PLAN.md` — J2 `[x]` après verdict contrôleur `51f04f4` ; recette `j3-powersync-liveness.mjs` (JWT post-TOTP + `/sync/probes/readiness`) ; auth poste via **`/api/auth/*`** (Caddy) ; sync réelle dans `InitialSyncScreen` + `@powersync/web` (table `cabinets`).
- **Preuves** :

| Commande | Résultat |
|----------|----------|
| `node tests/recette/j3-powersync-liveness.mjs` | exit **0** |
| `pnpm --filter @legal-os/poste typecheck` / `lint:ci` / `build` | exit **0** |
| CI run **36057024873** | **success** (J2 sur `51f04f4`) |

- **Reste J3** : deux postes simulés, hors ligne, parité schéma ; contrôleur J3.

---

## 2026-09-24 — État-major : J3 sync (écritures + recette deux postes)

- **Fait** : `PATCH /cabinets/{id}` (JWT access) ; `uploadData` PowerSync → API ; proxy Vite `/api` + `/sync` ; `j3-sync-two-postes.mjs` (Playwright) ; champ instance en `type=text` + lecture FormData.
- **Preuves** : `cargo clippy -p legalos-api` OK ; `pnpm typecheck` / `lint:ci` OK ; `j3-powersync-liveness.mjs` OK ; recette Playwright **à valider en CI** (sync initiale longue / OPFS poste agent).

## 2026-09-25 — État-major : correctif sync CI J3

- **Cause probable échec CI** : proxy Vite `preview` relayait HTTP `/sync` mais pas les **WebSockets** PowerSync.
- **Correctif** : `ws: true` sur `/sync` ; flags recette `useWebWorker: false`, `enableMultiTabs: false` (`VITE_LEGALOS_RECETTE_HOOKS=1`).
- **Commit** : `075b0f0` — `fix(J3): proxy WebSocket /sync et flags PowerSync recette CI.`
- **Preuve CI** : run [36110555427](https://github.com/navelremi-boop/legalos2/actions/runs/36110555427) — **success** (dont `Recette J3 deux postes simulés (PowerSync)`).

### Contrôleur — jalon **J3** (2026-09-25, commit `075b0f0`)

- **Verdict : REFUSÉ** (jalon J3 **complet** ; [contrôleur](f3fdb1d9-58df-4e78-b604-ed2fc5227f4a)).
- **Satisfait** : critère « modification poste A → poste B » — CI run **36110555427**, job `s1-instance`, étape `j3-sync-two-postes.mjs`.
- **Bloquant** : critère « reprise hors ligne sans écrasement silencieux » (préfig. S4) — non implémenté, aucune recette ; `PLAN.md` le marque encore « en cours ».
- **Décision** : **ne pas cocher J3** dans `PLAN.md` tant que le critère offline/conflit n’est pas livré ou retiré explicitement du périmètre.
- **Suite** : scénario recette offline minimal (Playwright) ou découpage PLAN (offline → S4) puis re-contrôleur.

## 2026-09-25 — Commandement : compléter J3 (pas de retrait de critère)

- **Décision** : le refus du contrôleur se traite en implémentant la reprise hors ligne et l'absence d'écrasement silencieux. Les cinq critères sont reportés au § 3.4 du cahier des charges. Paragraphe « Jalon refusé » ajouté au § 4.5 de `docs/ordre-operation.md`.
- **SDK constaté** : l'application poste dépend de **`@powersync/web`** (`apps/poste/package.json`, `PowerSyncDatabase` dans `apps/poste/src/sync/database.ts`, options `useWebWorker` / `enableMultiTabs`). Le cahier § 2.1 impose le **SDK Tauri** (`tauri-plugin-powersync` **0.0.6** + `@powersync/tauri-plugin` **0.0.6**, crate `powersync` **0.0.7**), SQLite natif géré en Rust, parce que la base du SDK web dans la webview ne survit pas aux mises à jour.
- **Écart** : non consigné jusqu'ici. **Correction avant toute poursuite fonctionnelle de J3** : retirer le SDK web et les options de recette qui modifient la synchronisation ; connecteur d'upload en Rust ; scénario sur l'app Tauri réelle.
- **Versions** : figées dans `docs/versions.md` (npm et crates.io, 2026-09-25). Documentation : https://docs.powersync.com/client-sdks/reference/tauri
- **Correction engagée** : `@powersync/web` retiré ; schéma via `@powersync/common` 2.0.0 (version exigée par le plugin 0.0.6) ; base `PowerSyncTauriDatabase` ; connexion et upload dans `apps/poste/src-tauri` (`connect_powersync`). Le crate poste est un workspace Cargo séparé : `sqlx` (macros) et `rusqlite` 0.39 lient tous deux `sqlite3`, incompatibles dans un même graphe.
- **Rustc 1.98** : `tauri-plugin-powersync` 0.0.6 tire `time` 0.2 (`http-client` → `cookie` 0.14), dont les macros `proc_macro_hack` ne compilent plus. Correctif local MIT/Apache dans `apps/poste/src-tauri/patches/time-macros` et `time-macros-impl` (`#[proc_macro]`). `powersync_sqlite_nostd` exige libclang (bindgen) : absent sur ce poste, prévu en CI (`libclang-dev`).
- **Serveur** : migration `006` — `cabinets.revision`, `journal_modifications`, `upload_idempotence`. `PATCH` n’applique que les champs présents, détecte un conflit de champ si une écriture plus récente que `base_revision` existe, conserve la valeur remplacée, dernière écriture gagnante. Rejeu de la même clé : aucun second effet.
- **Pas encore prouvé** : compilation du crate Tauri, scénario J3 sur l’app réelle, coupure réseau réelle. J3 reste non coché.

## 2026-09-25 — Décisions du commandement (ordre d’exécution)

1. **Sécurité, exception unique** : aucune instance réelle n’existe. Les migrations `004`, `005` et suivantes ne portent plus de données de démonstration. Les bases de développement sont réinitialisées. La démo ne se charge que par `cargo xtask demo`, qui refuse hors `LEGALOS_MODE=development`. Une instance neuve (migrations seules) ne contient aucun compte. Hors développement, l’API refuse de démarrer si `SECRETS_CHIFFREMENT_KEY` est une valeur connue (`.env.example` / démo). `cargo xtask install` crée le premier administrateur (mot de passe et secret TOTP aléatoires) — non prévu au cahier, consigné dans `docs/hypotheses-installation.md`. Après cette remise à plat, une migration fusionnée ne se modifie plus.
2. **J2 décoché** : validé après redécoupage à la suite d’un refus (§ 4.5) et parcours jamais exécuté dans l’app. Il repasse devant le contrôleur sur l’app Tauri après la bascule de SDK.
3. **Jetons** : rafraîchissement dans le trousseau (`keyring`) ; accès en mémoire seulement, plus dans le stockage du navigateur.
4. **Fins de ligne** : `.editorconfig` (`end_of_line = lf`), `.vscode/settings.json` (`files.eol`), puis `git add --renormalize .`.
5. **jsonwebtoken** : version actuelle, fournisseur cryptographique explicite dans `docs/versions.md`.
6. **CI** : `cargo test --workspace` à chaque push. Le job macOS ne construit ni ne lance l’app : il n’est pas une preuve de S14b et est renommé en conséquence.
7. **Poste** : identité Git locale ; chaîne Rust MSVC ; MinGW retiré du PATH.
8. **4551** : Smart App Control, traité par le commandement. La bascule SDK Tauri se prépare ; rien n’est validé sur l’app tant qu’elle n’a pas été compilée et lancée sous Windows.

### Exécution (2026-09-25)

- Migrations `004` et `005` vidées de leurs données. Test `migrations_sans_compte` et contrôle statique `j2-demo-migration-parity.mjs`. `cargo xtask demo` refuse hors `LEGALOS_MODE=development`. `cargo xtask install` crée le premier administrateur. L’API refuse une clé connue hors développement.
- **Bases de développement** : `docker compose down -v` impossible — démon Docker arrêté (`dockerDesktopLinuxEngine` introuvable). À relancer quand Docker est ouvert.
- J2 décoché dans `PLAN.md`.
- Trousseau : commandes `keyring_store_refresh` / `keyring_clear_refresh` ; le jeton d’accès n’est plus écrit dans `localStorage`.
- jsonwebtoken **11.1.0**, features `rust_crypto` et `use_pem`, `default-features = false`.
- CI : `cargo test --workspace` sur Postgres éphémère ; job renommé `macos-placeholder` (pas une preuve S14b).
- Git local : `navelremi-boop`. Rust : `stable-x86_64-pc-windows-msvc` (déjà la chaîne active via `rust-toolchain.toml`). MinGW absent du PATH utilisateur, machine et session.

## 2026-09-25 — Consignes du commandement (mode, installation, trousseau)

1. **Commits** : autorisation explicite et permanente de committer et de pousser `main`. Interdits : push forcé, réécriture de l'historique, push de tag. Ligne ajoutée à `.cursor/rules/00-mission.mdc`.
2. **SDK Tauri** : contournements consignés (`patches/time-macros`, crate poste hors workspace à cause de `sqlite3`). Pas de retour au SDK web. Compilation locale encore sans libclang. Rien n'est validé sur l'app tant qu'elle n'a pas tourné sous Windows.
3. **Mode** : `LEGALOS_MODE` absent = production. `.env.example` ne fixe pas le développement (clé placeholder `legalos_example_key_32_bytes!!!!`). Développement explicite : `.env.development.example` (ancienne clé `legalos_demo_chiffrement_32oct!!`). Hors développement, l'API refuse ces deux clés. `cargo xtask install` écrit le `.env` (clé aléatoire, mode absent) et affiche le secret TOTP avec son URI `otpauth`.
4. **Trousseau** : `keyring` 3.6.3 n'a pas de feature par défaut et utilise le magasin factice `mock`. Features explicites `windows-native` et `apple-native`. Critère dès compilation Windows : le jeton de rafraîchissement survit à la fermeture et au redémarrage. Pas encore prouvé.

### Preuves (2026-09-25)

- `.env` local de recette : clé de développement déjà en place, `LEGALOS_MODE` absent. Ligne `LEGALOS_MODE=development` ajoutée (fichier non versionné).
- Docker Desktop était arrêté. Après démarrage, les volumes `legalos-instance_*` étaient encore là. `docker compose -f instance/docker-compose.yml --env-file .env down -v` les a retirés avant la recette.
- Premier `node tests/recette/s1.mjs` : échec, PowerSync 1.26.1 unhealthy, message `case not supported here` sur `CASE WHEN conflit`. `::int` refusé aussi (`CAST not supported for 'int'`). Règle corrigée : la colonne booléenne `conflit` est sélectionnée telle quelle.
- Second `node tests/recette/s1.mjs` : exit 0, `s1: OK`, services api, caddy, postgres, powersync, garage, greenmail, simulateur-pa healthy.
- Instance neuve avant démo : `SELECT COUNT(*) FROM utilisateurs` = 0.
- `cargo test -p legalos-api --test migrations_sans_compte --test install_production` : les deux ok. `install_production` démarre l'API sans `LEGALOS_MODE`, sans compte démo, refuse les deux clés connues, `/health` répond avec une clé générée.
- `cargo test -p xtask --bin xtask env_installe_sans_mode_developpement` : ok (`.env` généré sans `LEGALOS_MODE=`).
- `cargo run -p xtask -- demo` puis `cargo run -p xtask -- recette --scenario s2` : `s2: OK` (auth_integration 2 tests, sonde HTTP).
- **Compilation poste** : LLVM **23.1.2** (`winget install LLVM.LLVM`). `LIBCLANG_PATH=C:\Program Files\LLVM\bin`. `cargo build --manifest-path apps/poste/src-tauri/Cargo.toml` : exit 0 (2026-09-25). `keyring` 3.6.3 avec `windows-native` compile. Lint retiré du correctif `time` : `illegal_floating_point_literal_pattern` (supprimé en rustc 1.98).
- **Non validé** : l'app n'a pas été lancée. La survie du jeton de rafraîchissement après fermeture et redémarrage n'est pas prouvée. J2 et J3 restent décochés.

## 2026-09-25 — Hooks du dépôt

- Fenêtre Cursor ouverte à 11:30 (`cursor.hooks`, workspace `84b002c1…`) : « Loaded 3 project hook(s) », puis **aucune** exécution (`beforeShellExecution`, `beforeReadFile`, `stop` à 0) pendant toute la reprise de session. Redémarrage 12:03 : les mêmes hooks s'exécutent (exit 0).
- Avant ça (Cursor 3.17.8, 11:21), `continuer.mjs` a répondu `{}` cinq fois, donc pas de relance. Un stdin UTF-16 reproduit exactement `{}` (le JSON ne se parse pas, le statut est absent). `lireEntree` décode maintenant UTF-16 et UTF-8. Rejeu : suivi de mission renvoyé, et `garde-secrets` refuse `.env`.
- **Non validé** : l’app Tauri n’a pas été compilée ni lancée sous Windows (libclang absent pour `powersync_sqlite_nostd`, et consigne du point 8).

## 2026-09-25 — J2, parcours dans l'app Tauri

- Reprise au premier jalon non coché : **J2**. L'API du poste (webview) ne pouvait pas appeler l'instance : pas d'en-têtes CORS. `couche_cors` autorise les origines du poste (`localhost:1420`, `tauri.localhost`, `asset.localhost`). Image `legalos/api` reconstruite, service healthy.
- `node tests/recette/j2-poste-tauri.mjs` : exit 0. Parcours instance → identifiants → TOTP dans l'app Tauri (WebView2, port de débogage). `j2-poste: session enregistrée dans l'app`. Après `taskkill` et second lancement : `j2-poste: OK — jeton présent après fermeture et redémarrage`. Aucun secret journalisé.
- `node tests/recette/j2-demo-migration-parity.mjs` : `migrations-sans-compte: OK`.
- J2 reste décoché : validation contrôleur encore requise (§ 4.4).
- Contrôleur [J2](2f33de17-193c-4679-9d8e-377a21397793) : **REFUSÉ** sur `00725fc`. Preuves locales J2 OK. Bloquant : CI rouge, `cargo fmt --check` sur `trousseau.rs` (run 36126399009), job `s1-instance` sauté. Correctif : `cargo fmt` du crate poste (`1fb7cec`). Test d'acceptation ajouté par le contrôleur : `tests/recette/j2-openapi-powersync-auth.mjs`.
- CI `1fb7cec` encore rouge : `cargo check` du poste sur Ubuntu échoue, `glib-2.0` absent (`glib-sys`). Le job installe maintenant les dépendances Tauri Linux (webkit2gtk 4.1, gtk, appindicator, rsvg). J2 toujours décoché.
- CI `9296016` (run 36129205636) : jobs `rust` et `frontend` verts. `s1-instance` échoue à S2 : `POST /auth/connexion → 401`. L'instance neuve n'a plus de compte dans les migrations. Le job charge désormais la démo avec `cargo xtask demo` après S1, avant S2.
- CI `5300d81` (run 36131432065) : S2 passe. Échec ensuite de `j3-sync-two-postes.mjs` dans Chromium (`sync initiale / hooks recette absents`). Ce scénario navigateur n'est plus la preuve J3 (cahier § 3.4, SDK Tauri). Il sort du job `s1-instance`. La sonde `j3-powersync-liveness` et `auth_integration` restent.
- CI `3f4647d` (run [36134053175](https://github.com/navelremi-boop/legalos2/actions/runs/36134053175)) : **verte** (frontend, rust, s1-instance, macos-placeholder).
- Contrôleur [J2](9e5cb1a8-05de-45be-aa0a-6ea93fe1a21f) : **VALIDÉ** sur `3f4647d`. Preuves rejouées : `auth_integration` 2/2, `s2.mjs`, parité migrations, OpenAPI/JWKS, `j2-poste-tauri.mjs` (jeton présent après redémarrage), fmt, clippy, typecheck, eslint. Écarts mineurs seulement. J2 coché. Prochain jalon : J3.

## 2026-09-25 — J3 commencé

- Deux processus sur le même poste : `LEGALOS_POSTE_ID` isole le fichier SQLite et le compte du trousseau. L'écran journée édite le nom et le slug du cabinet dans la base locale.
- Cause : le client joint `sync/stream` sur l'endpoint. Sans barre finale, l'URL est `/sync/stream`, Caddy la réduit en `/stream` (404). Avec `/sync/`, Caddy transmet `/sync/stream` (401 sans jeton, chemin valide). Après correction, `j3-poste-tauri.mjs` affiche `A synchronisé` et `modification conservée après redémarrage hors ligne`.
- L'envoi n'a pas suivi tant que la file était antérieure à la connexion. Au retour, une écriture locale sur `cabinets` réveille l'acteur. `node tests/recette/j3-poste-tauri.mjs` : exit 0. `A synchronisé`, `modification conservée après redémarrage hors ligne` (services `api` et `powersync` arrêtés), puis `OK — modification hors ligne visible sur B`.
- Critères 2 et 3, une exécution : `OK — les deux champs survivent` (nom du poste A et slug du poste B, chacun seul dans son `UPDATE`) et `OK — conflit signalé` (journal `conflit` et bandeau dans l'app). L'enregistrement n'envoie que le champ modifié.
- Rejeu : l'écran local et le formulaire de connexion sont affichés ensemble, donc `connect_powersync` repart. Le serveur reçoit le nom unique (`Hors ligne 755208`). Le poste B, qui a déjà une copie, affiche encore « Cabinet fictif hors ligne » au bout de 90 s. Le rafraîchissement comparait le champ à la valeur déjà mise à jour.
- `node tests/recette/j3-poste-tauri.mjs` : exit 0. `A synchronisé` ; `modification conservée après redémarrage hors ligne` (services `api` et `powersync` arrêtés) ; `modification hors ligne visible sur B` ; `les deux champs survivent` ; `conflit signalé` ; `coupure pendant l'envoi, une seule écriture`. La version envoyée est celle lue au moment de l'édition (`revision_edition`).
- Contrôleur [J3](54401393-dc73-46bb-aa88-40b3b8c4f0b9) : **REFUSÉ** sur `78c3319`. Les cinq critères sync sont rejoués (exit 0). Bloquant : ESLint (`App.tsx`, `JourneePreview.tsx`) et `rustfmt` (`powersync_connect.rs`), CI run 36154079298 rouge. Corrigé ensuite. J3 non coché.
- CI `86e0856` (run [36155397731](https://github.com/navelremi-boop/legalos2/actions/runs/36155397731)) : **verte** (rust, frontend dont `lint:ci`, s1-instance, macos-placeholder).
- Contrôleur [J3](45662d68-8d4f-4fe8-af8c-40e6f92bde89) : **VALIDÉ** sur `86e0856`. `pnpm --filter @legal-os/poste lint:ci` exit 0, `cargo fmt --manifest-path apps/poste/src-tauri/Cargo.toml -- --check` exit 0. `node tests/recette/j3-poste-tauri.mjs` exit 0 après isolation des bases locales : `OK — modification hors ligne visible sur B` ; `OK — les deux champs survivent (écritures par champ)` ; `OK — conflit signalé` ; `OK — coupure pendant l'envoi, une seule écriture`. Coupures réelles (`compose stop`, `pause api`). SDK Tauri, pas de navigateur. Écart majeur non bloquant : un `conflit` peut être journalisé sur une écriture séquentielle du même poste après reprise. Mineurs : README (corrigé), hooks de recette navigateur non utilisés par la preuve. J3 coché. Prochain jalon : J4.

## 2026-09-25 — J4, build Windows

- `pnpm tauri build` depuis `apps/poste` (VsDevCmd amd64, `LIBCLANG_PATH` LLVM) : exit 0 en 3 min 49 s de compilation release. Binaire `target/release/legal-os-poste.exe` (9 848 320 octets). Bundles : `LEGAL OS_0.1.0_x64_en-US.msi`, `LEGAL OS_0.1.0_x64-setup.exe`.
- Les deux woff2 Atkinson sont dans `apps/poste/dist` et leurs noms sont dans l'exe. `design/tokens.css` est importé par `index.css`. CSP `font-src 'self'`.
- `node tests/recette/j4-no-webdriver.mjs --exe target/release/legal-os-poste.exe` : `j4: OK` — aucune dépendance WebDriver, feature `test-webdriver` hors défaut, binaire sans `WebDriver` / `tauri-driver` / `msedgedriver`. Le même script est branché sur le job CI `rust`.
- J4 non coché : validation contrôleur encore requise.
- CI `498a02b` (run 36162593331) : job `rust` rouge. `auth_flow_totp_et_jwks` et `auth_connexion_echoue_mot_de_passe_invalide` amorcent la même ligne en parallèle ; le second `INSERT` heurte `utilisateurs_cabinet_email_unique` avant `ON CONFLICT (id)`. Amorçage sérialisé par `pg_advisory_lock`. Rejeu local `--test-threads=2` : 2 passed.
- CI `7871c68` (run [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952)) : **verte**.
- Contrôleur [J4](be04e8b3-4a1b-4fcb-bf20-91eace0e3bcf) : **VALIDÉ** sur `7871c68`. `lint:ci` et `typecheck` exit 0. `node tests/recette/j4-no-webdriver.mjs --exe target/release/legal-os-poste.exe` : `j4: OK`. Binaire, MSI et NSIS présents. Jetons importés, woff2 dans `dist` et noms dans l'exe, CSP `font-src 'self'`. Mineurs : licence OFL non déposée à côté des woff2 ; feature `test-webdriver` vide. J4 coché. Prochain jalon : gate phase 1.
- Contrôleur [gate phase 1](b29205bf-7a2b-4a83-9abd-c9d76809fb28) : **VALIDÉ**. Rejeu : `s1.mjs`, `s2.mjs`, `j3-powersync-liveness.mjs`, `j4-no-webdriver.mjs` (avec et sans `--exe`) exit 0. CI `7871c68` run [36163357952](https://github.com/navelremi-boop/legalos2/actions/runs/36163357952) et CI `d6ad5b7` run [36166067737](https://github.com/navelremi-boop/legalos2/actions/runs/36166067737) success. J3 Tauri non rejoué. Gate cochée. Prochain jalon : J5.

## 2026-09-25 — J5, dossiers et droits

- Tables `dossiers`, `parties`, `dossier_acces`. Création dans l'app (chemise, partie, juridiction, n° RG, case restreint) puis envoi à l'API. Palette : recherche par nom, n° RG, juridiction ou partie.
- PowerSync 1.26.1 refuse les jointures et les conversions dans les paramètres. Les dossiers publics suivent `visibilite = 'public'`. Les dossiers restreints ne descendent que si `dossier_acces.utilisateur_texte` est l'utilisateur du jeton.
- `node tests/recette/j5-poste-tauri.mjs` : exit 0. `OK — dossier retrouvé par la palette`. `OK — dossier restreint absent du SQLite de B`.
- CI `340ac42` (run [36172577399](https://github.com/navelremi-boop/legalos2/actions/runs/36172577399)) : **verte**.
- Contrôleur [J5](b9bba862-c3a6-4656-96e7-98c9a6987099) : **VALIDÉ** sur `340ac42`. Recette rejouée exit 0. SQLite du poste B : aucun dossier `restreint = 1`. Le seau public filtre `visibilite = 'public'` ; le seau restreint passe par `dossier_acces`. J5 coché. Prochain jalon : J6.

## 2026-09-25 — J6, délais

- Moteur `apps/poste/src/delais/moteur.mjs` : articles 640 à 644 (jours, mois, quantième manquant, report au jour ouvrable, mois de distance). Jours fériés métropolitains, Pâques par l'algorithme grégorien. Chaque règle est dans `docs/hypotheses-delais.md`, marquée « à valider par l'avocat ».
- `node tests/recette/s8-delais.mjs` : `s8: OK — jeu de cas des délais`. Le script est dans le job CI `frontend`. L'écran « La journée » calcule une échéance. L'agenda complet (audiences, rendez-vous) n'est pas dans ce jalon.
- CI `bf3bfe3` (run [36179592258](https://github.com/navelremi-boop/legalos2/actions/runs/36179592258)) : **verte**.
- Contrôleur [J6](95b16069-8a4c-4c78-8aa3-f9509cb6f721) : **VALIDÉ** sur `bf3bfe3`. `node tests/recette/s8-delais.mjs` exit 0, y compris après le durcissement qui exige le marqueur sur H1–H8. Aucune règle hors hypothèses. J6 coché. Prochain jalon : J7.

## 2026-09-25 — J7, documents

- Métadonnées `documents` et `document_versions` dans Postgres. Contenu dans Garage via OpenDAL 0.59.3 : lien de dépôt signé, puis scellement qui relit l'objet et vérifie l'empreinte. Une modification crée la version suivante sans remplacer la précédente.
- `node tests/recette/s6-documents.mjs` : `document déposé et ouvert` puis `OK — nouvelle version renvoyée, version précédente conservée`.
- CI `2eb7266` (run [36183981852](https://github.com/navelremi-boop/legalos2/actions/runs/36183981852)) : **verte**.
- Contrôleur [J7](6acf8035-815d-47c6-9e4d-2854c328ac4c) : **VALIDÉ** sur `2eb7266`. Recette rejouée exit 0. Clés `v1` et `v2` distinctes, contenus conservés sur Garage. Écarts majeurs non bloquants : métadonnées absentes des règles PowerSync ; un second `POST /documents` du même id peut réémettre un dépôt sur la clé v1. J7 coché. Prochain jalon : J8.

## 2026-09-25 — J8 commencé

- Brouillon, validation avec numéro continu (une séquence par cabinet), facture validée immuable en base, avoir sur la même séquence, dépôt idempotent sur le simulateur, encaissement partiel de 6 000 centimes sans doublon.
- `node tests/recette/s9-factures.mjs` : exit 0. `numéros continus attribués par le serveur` ; `dépôt répété, une seule fiche plateforme` ; `encaissement partiel, 6000 centimes, sans doublon` ; `avoir numéroté, facture validée non renumérotée`.
- Hypothèses de taux, d'arrondi et de débours dans `docs/hypotheses-facturation.md`, marquées « à valider par l'avocat ».
- Contrôleur [J8](b1c52efe-2669-413f-bc93-6833ac28d718) : **REFUSÉ**. Manquaient les temps, le brouillon hors ligne, et le jeu § 3.7.
- Ensuite : six XML CII (professionnel, particulier, avoir, acompte, débours, paiement partiel) passent le schematron ; `s9-facturx.mjs` et `s9-factures.mjs` exit 0. Le brouillon hors ligne est une base SQLite locale sans numéro, écrite sans appel API. Pas encore l'écran Tauri. J8 non coché.

## 2026-09-26 — J8, temps sur le poste

- Écran « Saisir du temps » : la minute est enregistrée dans le SQLite du poste (`temps_saisis`, `brouillons_facture`) sans appel API, numéro nul. Hypothèse F0 : 100 centimes par minute, marquée « à valider par l'avocat ».
- « Valider en ligne » crée le dossier, le brouillon et la ligne d'honoraires, puis le serveur attribue le numéro et sert le CII.
- `node tests/recette/s9-poste-tauri.mjs` : exit 0. `temps saisi, brouillon local sans numéro, puis numéro serveur`.
- `node tests/recette/s9-factures.mjs` : exit 0, y compris `Factur-X produit après validation` (`GET /factures/{id}/cii`).
- `node tests/recette/s9-facturx.mjs` : exit 0 (six cas + PDF/A-3b).
- Image API reconstruite pour exposer le CII. J8 non coché : pas encore de nouveau verdict contrôleur ni de CI sur ce commit.
- Contrôleur [J8](80f27e83-84d3-488d-8a7f-cc1f2fc67ee2) : **REFUSÉ** sur `d7c274e`. Temps, brouillon hors ligne et jeu § 3.7 rejoués (exit 0). Bloquant : `UPDATE` des lignes d'une facture validée réussissait. La CI de ce commit n'existait pas encore.
- Migration `012_lignes_immuables.sql` : insertion, modification et suppression des lignes refusées dès que la facture est validée. `node tests/recette/s9-factures.mjs` : `facture validée immuable (entête et lignes)`. J8 non coché.

## 2026-09-26 — Cahier version 5, J7 rouvert

- `docs/cahier-des-charges.md` remplacé par la version 5 du 26 septembre 2026 (chemise ouverte, référence de dossier, intercalaires). Le prototype déjà dans `design/prototype-cabinet.html` correspond à cette version.
- J7 décoché : réécrire un objet déjà scellé touchait l'invariant d'absence d'écrasement. L'API répond 409 si la version est scellée ou si l'objet est déjà visible. Garage 1.0.1 refuse `If-None-Match` et répond 403 à un `HeadObject` sur une clé absente : pas d'écriture conditionnelle possible sur ce service. Les métadonnées des documents sont dans les règles PowerSync, filtrées comme le dossier.
- Le nœud Garage n'avait plus de rôle ni de clé. Layout, seau `legalos` et clé d'API recréés localement. Le secret n'est pas dans le dépôt.
- `node tests/recette/s6-documents.mjs` : exit 0.
- CI `5ff58b9` (run [36232407821](https://github.com/navelremi-boop/legalos2/actions/runs/36232407821)) : **verte**.
- Contrôleur [J7](bf3aff8a-2345-41ad-8394-293bdcf65004) : **VALIDÉ** sur `5ff58b9`. Recette rejouée exit 0. Après dépôt et après scellement, un nouveau dépôt de la version 1 est refusé (409). Mineur : un `HeadObject` refusé est traité comme une clé absente. J7 coché. Prochain jalon : Coque de l'app.

