# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-26 (jalon en cours : **Migration Sync Streams**).

Références : `docs/cahier-des-charges.md`, `docs/ordre-operation.md`, scénarios S1–S14.

---

## Phase 0 — Reconnaissance et planification

- [x] **J0** — Phase 0 complète (plan, journal, blocages, versions, dépôt, CI, contrats, validation contrôleur)
  - **Livrables** : `PLAN.md`, `JOURNAL.md`, `BLOCAGES.md`, `docs/versions.md`, workspace Rust + pnpm, `design/tokens.css`, migrations, `AppSchema.ts`, `docs/sync-streams.md`, compose, xtask, CI.
  - **Critères** : typecheck/build poste ; fmt/clippy ; contrats présents ; contrôleur VALIDÉ.
  - **Responsable** : état-major (+ instance-backend, poste-interface).

---

## Phase 1 — Fondations (gate : contrôleur avant phase 2)

- [x] **J1** — Instance S1
- [x] **J2** — Auth API, 2FA, premier lancement — VALIDÉ `3f4647d` (parcours Tauri)
- [x] **J3** — Sync bout en bout Tauri — VALIDÉ `86e0856`
- [x] **J4** — Build Tauri, polices, pas de WebDriver — VALIDÉ `7871c68`
- [x] **Gate phase 1** — VALIDÉ

---

## Phase 2 — Lots parallèles

Ordre architecte (révisé 2026-09-26) : **Migration Sync Streams** → **J8** → **Référence** → **Coque** → **Vue scindée** → **Intercalaires** → **J9** → J10.

- [x] **J5** — Dossiers, contacts, droits — VALIDÉ `340ac42`
- [x] **J6** — Agenda et délais — VALIDÉ `bf3bfe3` ; reprise H1–H13 `0fc0c17` ; H7/H10/H12 → B10
- [x] **J7** — Documents et versions — VALIDÉ `5ff58b9`
- [ ] **Migration Sync Streams** — **jalon en cours**
  - `sync-config.yaml` édition 3 ; `sync_config.path` ; `auto_subscribe: true` ; JOIN `dossier_acces` ≤ 2 tables ; `visibilite` fille non lue pour l’auth.
  - Rejouer S5, J3, J5, J7 ; S5 par flux. Service ≥ 1.26.1. GHSA-q6wc-xx4m-92fj + 1.23.3 dans `docs/versions.md`.
  - Contrat `docs/sync-streams.md`. Contrôleur **REFUSÉ** `5f46967` (GHSA) puis `a00e56d` (S5 SQLite) — correctif j5 + `s5-sqlite-par-flux` ; **revalider**.
- [ ] **J8** — Temps et facturation (S9)
  - Dette conflit J3 (fin phase 2). Code sync temps (`c34a033`) présent — ne pas cocher sans Streams VALIDÉ puis contrôleur J8.
- [ ] **Référence de dossier** — § 3.4
- [ ] **Coque de l'app** — § 7 ; écarts captures corrigés `22d765e` ; dette CORS avant fin
- [ ] **Vue scindée** — § 7.4
- [ ] **Intercalaires personnalisés** — § 7.4
- [ ] **J9** — Mail étapes 1–3
- [ ] **J10** — Écrans restants § 7.6

### Dettes transverses (§ 4.4)

- [x] **Immédiat** : gardes fail-closed (`garde-hooks.mjs`)
- [ ] **Avant fin Coque** : CORS `tauri://localhost` ; 1420 en développement seulement
- [ ] **Avant J14** : `test-webdriver` ; build sans outils de débogage
- [ ] **Fin phase 2** : cargo-deny/audit ; délais TS strict ; OFL ; signalement PowerSync `time` 0.2
- [ ] **Mensuel** : avis de sécurité PowerSync (GHSA édition 3)

Chaque jalon : recettes + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

- [ ] **J11** — Mail étapes 4–5
- [ ] **J12** — Révocation postes (S10)
- [ ] **J13** — Export complet (S12)
- [ ] **J14** — Mises à jour à chaud et distribution (S11, S14a)

---

## Phase 4 — Durcissement et recette

- [ ] **J15** — `cargo xtask recette` S1–S14a (Windows)
- [ ] **J16** — S14b macOS CI + captures S13
- [ ] **J17** — Revue sécurité, `RAPPORT.md`, `.mission/TERMINEE`

---

## Rappel

Un jalon n'est coché que si § 4.4 de l'ordre d'opération est entièrement satisfait (preuves dans `JOURNAL.md`).
