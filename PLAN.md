# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-24 (état-major — J2 en cours, correctifs CI + PowerSync JWKS).

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

- [ ] **J2** — Auth, 2FA, premier lancement poste S2
  - **Critères** : tests intégration API auth ; scénario recette S2 automatisé ; OpenAPI à jour ; JWT/JWKS PowerSync.
  - **Responsable** : `instance-backend` + `poste-interface`

- [ ] **J3** — Sync bout en bout (1 table, 2 postes simulés)
  - **Critères** : modification poste A visible poste B ; reprise hors ligne sans écrasement silencieux (préfiguration S4).
  - **Responsable** : état-major coordonne ; `poste-interface` + `instance-backend`

- [ ] **J4** — Application Tauri : jetons, police, CI verte
  - **Critères** : `pnpm tauri build` (Windows) ; clippy/ts/eslint verts en CI ; pas de WebDriver en build release.
  - **Responsable** : `poste-interface`

- [ ] **J1–J4** — **Gate phase 1** : contrôleur VALIDÉ avant tout jalon phase 2.

---

## Phase 2 — Lots parallèles

- [ ] **J5** — Dossiers, contacts, droits (S3, S5)
- [ ] **J6** — Agenda et délais (S8, `docs/hypotheses-delais.md`)
- [ ] **J7** — Documents et versions (S6)
- [ ] **J8** — Temps et facturation électronique (S9)
- [ ] **J9** — Mail étapes 1–3 (S7 partiel)
- [ ] **J10** — Écrans clés conformes au prototype (base)

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
