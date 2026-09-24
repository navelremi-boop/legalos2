# Recette LEGAL OS (S1–S14)

Scénarios d'acceptation dérivés de `docs/ordre-operation.md` § 3.

- **J0** : `cargo xtask recette --scenario j0` (contrats + build UI ; pas de services).
- **S1** : `node tests/recette/s1.mjs` — `cargo xtask recette --scenario s1`, 7 services Docker healthy, probes HTTP API/Caddy (`.env` racine, Docker actif).
- **S2** : `node tests/recette/s2.mjs` — connexion + TOTP + JWKS sur l’API (après S1) ; vérifie que le `kid` du JWT d’accès figure dans le JWKS et `aud` = `JWT_AUDIENCE`. `cargo xtask recette --scenario s2` ajoute les tests intégration Rust (`auth_integration`).
- **J2 (contrat)** : `node tests/recette/j2-demo-migration-parity.mjs` — le `totp_secret_chiffre` de `004_demo_fictif.sql` doit correspondre au secret TOTP fictif documenté (sans Postgres). `node tests/recette/j2-onboarding-scope.mjs` — `FirstLaunchFlow` : auth réelle, pas de `runInitialSync` (sync = J3).
- **J3 (probe)** : `node tests/recette/j3-powersync-liveness.mjs` — après S1/S2, `/sync/probes/liveness` + `/sync/probes/readiness` avec JWT post-TOTP (Caddy).
- **J3 (deux postes)** : `node tests/recette/j3-sync-two-postes.mjs` — Playwright (Chromium) : modification SQLite poste A → réplication poste B (stack S1 + build poste hooks recette).
- **S3+** : nécessitent Docker et binaires Rust (voir `BLOCAGES.md`).

Les tests exécutables sont ajoutés par le **contrôleur** avant lecture de l'implémentation (ordre d'opération § 4.3).
