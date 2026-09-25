# Recette LEGAL OS (S1–S14)

Scénarios d'acceptation dérivés de `docs/ordre-operation.md` § 3.

- **J0** : `cargo xtask recette --scenario j0` (contrats + build UI ; pas de services).
- **S1** : `node tests/recette/s1.mjs` — `cargo xtask recette --scenario s1`, 7 services Docker healthy, probes HTTP API/Caddy (`.env` racine, Docker actif).
- **S2** : `node tests/recette/s2.mjs` — connexion + TOTP + JWKS sur l’API (après S1) ; vérifie que le `kid` du JWT d’accès figure dans le JWKS et `aud` = `JWT_AUDIENCE`. `cargo xtask recette --scenario s2` ajoute les tests intégration Rust (`auth_integration`).
- **J2 (contrat)** : `node tests/recette/j2-demo-migration-parity.mjs` — le `totp_secret_chiffre` de `004_demo_fictif.sql` doit correspondre au secret TOTP fictif documenté (sans Postgres). `node tests/recette/j2-onboarding-scope.mjs` — `FirstLaunchFlow` : auth réelle, pas de `runInitialSync` (sync = J3).
- **J3 (probe)** : `node tests/recette/j3-powersync-liveness.mjs` — après S1/S2, `/sync/probes/liveness` + `/sync/probes/readiness` avec JWT post-TOTP (Caddy).
- **J3 (deux postes)** : `node tests/recette/j3-poste-tauri.mjs` — app Tauri réelle (WebView2), cinq critères du cahier § 3.4. `j3-sync-two-postes.mjs` est un ancien scénario Chromium ; ce n'est pas la preuve J3.
- **J4** : `node tests/recette/j4-no-webdriver.mjs` — features par défaut sans WebDriver, jetons et woff2 embarqués. `--exe` contrôle le binaire release. Le bundle Windows se prouve avec `pnpm tauri build` depuis `apps/poste`.
- **J5** : `node tests/recette/j5-poste-tauri.mjs` — création d'un dossier dans l'app Tauri, retrouvé par la palette (S3) ; le dossier restreint est absent du SQLite du collaborateur non autorisé (S5).
- **S6** : `node tests/recette/s6-documents.mjs` — dépôt, ouverture, modification : la version 2 est relue et la version 1 reste (Garage).
- **S8** : `node tests/recette/s8-delais.mjs` — jeu de cas de la computation des délais. Règles dans `docs/hypotheses-delais.md`, chacune « à valider par l'avocat ».
- **S9 (partiel)** : `node tests/recette/s9-factures.mjs` — brouillon, numéro continu, dépôt idempotent, encaissement partiel, avoir. `node tests/recette/s9-facturx.mjs` — schematron EN 16931 et PDF/A-3b (Typst, Saxon, veraPDF locaux ou CI).
- **S3+** : nécessitent Docker et binaires Rust (voir `BLOCAGES.md`).

Les tests exécutables sont ajoutés par le **contrôleur** avant lecture de l'implémentation (ordre d'opération § 4.3).
