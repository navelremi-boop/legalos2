# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-24 (état-major — J2 VALIDÉ ; J3 sync PowerSync en cours).

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

- [ ] **J2** — Auth API, 2FA, premier lancement poste (connexion instance)
  - **Décision 2026-09-25** : décoché. Validé après redécoupage à la suite d’un refus (§ 4.5) ; le parcours n’a jamais été exécuté dans l’app Tauri. Il repasse devant le contrôleur après la bascule de SDK.
  - **Périmètre** : authentification HTTP (connexion + TOTP + JWKS) et parcours poste **instance → identifiants → TOTP → session enregistrée**. Le scénario produit **S2** complet (ordre d’opération § 3, sync initiale) s’achève au **J3**.
  - **Critères** : `auth_integration` (Postgres réel) ; `tests/recette/s2.mjs` + `j2-demo-migration-parity.mjs` ; OpenAPI auth ; JWT `aud` / JWKS alignés PowerSync (`client_auth` instance) ; UI onboarding sans simulation de téléchargement de données.
  - **Hors périmètre J2** : synchronisation PowerSync bout en bout, probe service `/sync` avec jeton (J3).
  - **Responsable** : `instance-backend` + `poste-interface`

- [ ] **J3** — Sync bout en bout (1 table, 2 postes, app Tauri réelle)
  - **Critères** : cahier des charges § 3.4 (cinq points : persistance hors ligne et reprise, fusion par champ, conflit signalé avec journal, ni perte ni doublon, coupure réseau réelle). Recette sur l'app Tauri, SDK `tauri-plugin-powersync`, sans option qui change le comportement de sync.
  - **Écart consigné** : l'app utilisait `@powersync/web` ; correction avant poursuite (voir `JOURNAL.md` 2026-09-25).
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
