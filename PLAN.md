# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-26 (jalon en cours : **Référence de dossier**).

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
- [x] **Migration Sync Streams** — VALIDÉ `9f80388` (contrôleur ; CI `36265441004`)
  - `sync-config.yaml` édition 3 ; `auto_subscribe: true` ; JOIN `dossier_acces` ≤ 2 ; `visibilite` fille non lue pour l’auth.
  - S5 SQLite par flux (`j5-poste-tauri` + `s5-sqlite-par-flux`) ; service 1.26.1 ; GHSA + 1.23.3 ; `docs/sync-streams.md`.
- [x] **J8** — Temps et facturation (S9) — VALIDÉ `e8eb6b2` (contrôleur ; CI `36269667975`)
  - PlateformeAgreee ; PDF/CII à la validation ; avoir+lignes ; e-reporting ; revue 31 OK. Dette conflit J3 (fin phase 2).
- [ ] **Référence de dossier** — § 3.4 — **jalon en cours**
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
