# Recette LEGAL OS (S1–S14)

Scénarios d'acceptation dérivés de `docs/ordre-operation.md` § 3.

- **J0** : `cargo xtask recette --scenario j0` (contrats + build UI ; pas de services).
- **S1** : `node tests/recette/s1.mjs` — `cargo xtask recette --scenario s1`, 7 services Docker healthy, probes HTTP API/Caddy (`.env` racine, Docker actif).
- **S2+** : nécessitent Docker et binaires Rust (voir `BLOCAGES.md`).

Les tests exécutables sont ajoutés par le **contrôleur** avant lecture de l'implémentation (ordre d'opération § 4.3).
