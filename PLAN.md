# LEGAL OS — Plan de mission

Dernière mise à jour : 2026-09-27 (jalon en cours : **Conflits généralisés**).

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

Ordre architecte (révisé 2026-09-27) : **Migration Sync Streams** → **J8** → **Référence** → **Conflits généralisés** → **Référence personnalisable (R0)** → **Coque** → **Vue scindée** → **Intercalaires** → **J9** → J10.

- [x] **J5** — Dossiers, contacts, droits — VALIDÉ `340ac42`
- [x] **J6** — Agenda et délais — VALIDÉ `bf3bfe3` ; reprise H1–H13 `0fc0c17` ; H7/H10/H12 → B10
- [x] **J7** — Documents et versions — VALIDÉ `5ff58b9`
- [x] **Migration Sync Streams** — VALIDÉ `9f80388` (contrôleur ; CI `36265441004`)
  - `sync-config.yaml` édition 3 ; `auto_subscribe: true` ; JOIN `dossier_acces` ≤ 2 ; `visibilite` fille non lue pour l’auth.
  - S5 SQLite par flux (`j5-poste-tauri` + `s5-sqlite-par-flux`) ; service 1.26.1 ; GHSA + 1.23.3 ; `docs/sync-streams.md`.
- [x] **J8** — Temps et facturation (S9) — VALIDÉ `e8eb6b2` (contrôleur ; CI `36269667975`)
  - PlateformeAgreee ; PDF/CII à la validation ; avoir+lignes ; e-reporting ; revue 31 OK. Dette conflit J3 (fin phase 2).
- [x] **Référence de dossier** — § 3.4 — VALIDÉ `6a1a050` (contrôleur ; CI `36272379503`)
  - Critères : `node tests/recette/reference-dossier.mjs` ; `node tests/recette/reference-dossier-api.mjs` ; `node tests/recette/reference-dossier-controleur.mjs` ; `node tests/recette/j5-poste-tauri.mjs` (coupure réelle : « Référence en attente » puis référence serveur) ; `node tests/recette/reference-dossier-ecran.mjs`.
- [ ] **Conflits généralisés** — § 3.4, invariant n° 2 — **jalon en cours** (consignes architecte 1 et 2 du 26/09)
  - **Journal** : `journal_modifications.dossier_id` (nul pour le cabinet) ; trois flux `journal_cabinet`, `journal_publics`, `journal_restreints` (jointures des tables filles) ; plus de journal dans `cabinet_global`. Livré avant qu'une autre table que `cabinets` n'alimente le journal.
  - **Conflits** : dossiers, parties, temps, brouillons, taux (intercalaires à leur jalon). Révision de base envoyée avec chaque modification ; dernière écriture gagnante par champ ; valeur remplacée journalisée ; conflit signalé dans l'app ; écriture séquentielle du même poste non comptée comme conflit (dette J3) ; données validées immuables.
  - Critères : S5 — conflit sur un dossier restreint, entrée absente du SQLite du poste non autorisé ; un conflit par table sur deux postes Tauri avec une modification hors ligne ; `cargo clippy --workspace --all-targets -- -D warnings` ; `node tests/recette/s5-sync-streams.mjs` ; contrôleur.
  - Responsables : instance-backend (API, migration, flux), poste-interface (file d'envoi, signal dans l'app).
- [ ] **Référence personnalisable (R0)** — arbitrage R0 et complément du 27/09
  - Modèle par cabinet (jetons `{AAAA}` `{AA}` `{N}` `{N:k}` `{INI}`, texte libre dont « / ») ; constructeur visuel par blocs dans Réglages, synchronisé avec le modèle texte, aperçu en direct ; référence affichée, stockée, imprimée et recherchée avec ses « / » ; formes normalisées (adresse de classement, noms de fichiers d'export) écrites et testées dans le domaine.
  - Critères : modèles `{AAAA}/{N:3}`, `RN/{AA}/{N:4}`, `{N}/{AAAA}` et sans séparateur, attribués par l'API et retrouvés par la palette ; tests unitaires des normalisations ; contrôleur.
- [ ] **Coque de l'app** — § 7 ; écarts captures corrigés `22d765e` ; points médians de La journée retirés et contrôle CI (consigne 3) ; captures B9 régénérées ; dettes ci-dessous
- [ ] **Vue scindée** — § 7.4
- [ ] **Intercalaires personnalisés** — § 7.4 ; conflits par champ comme les autres tables (consigne 2)
- [ ] **J9** — Mail étapes 1–3 ; adresse de classement avec la forme normalisée de la référence, reconnaissance des deux formes (R0)
- [ ] **J10** — Écrans restants § 7.6

### Dettes transverses (§ 4.4)

- [x] **Immédiat** : gardes fail-closed (`garde-hooks.mjs`)
- [x] **Immédiat** : images et compilations depuis un arbre de travail en CRLF (majeur 1 du contrôle Référence) — `Dockerfile.api` ramené en LF, contrôle `encodage-texte.mjs`, outil `realigner-migrations-lf.mjs`
- [ ] **Avant fin Coque** : CORS `tauri://localhost` ; 1420 en développement seulement
- [ ] **Avant fin Coque** : onglets de démonstration aux références écrites en dur (`CoqueApp.tsx:56`, majeur 2 du contrôle Référence) ; onglets à 800 px ; indicateur « Synchronisé » pendant une coupure ; contenu de démonstration dans un vrai dossier
- [ ] **Avant J14** : `test-webdriver` ; build sans outils de débogage
- [ ] **Fin phase 2** : cargo-deny/audit ; délais TS strict ; OFL ; signalement PowerSync `time` 0.2
- [ ] **Mensuel** : avis de sécurité PowerSync (GHSA édition 3)

Chaque jalon : recettes + clippy + contrôleur.

---

## Phase 3 — Intégration avancée

- [ ] **J11** — Mail étapes 4–5
- [ ] **J12** — Révocation postes (S10)
- [ ] **J13** — Export complet (S12) ; noms de fichiers et de dossiers avec la forme normalisée de la référence (R0)
- [ ] **J14** — Mises à jour à chaud et distribution (S11, S14a)

---

## Phase 4 — Durcissement et recette

- [ ] **J15** — `cargo xtask recette` S1–S14a (Windows)
- [ ] **J16** — S14b macOS CI + captures S13
- [ ] **J17** — Revue sécurité, `RAPPORT.md`, `.mission/TERMINEE`

---

## Rappel

Un jalon n'est coché que si § 4.4 de l'ordre d'opération est entièrement satisfait (preuves dans `JOURNAL.md`).
