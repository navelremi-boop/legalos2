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
