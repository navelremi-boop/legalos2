---
paths:
  - "crates/**/*.rs"
  - "apps/poste/src-tauri/**/*.rs"
  - "xtask/**/*.rs"
  - "Cargo.toml"
  - "crates/**/Cargo.toml"
---

# Rust

- **Lints du workspace** (`[workspace.lints]` du `Cargo.toml` racine) : `unsafe_code = "forbid"` ; clippy `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`, `dbg_macro` en `deny` hors tests. `cargo clippy --all-targets -- -D warnings` doit passer.
- **Erreurs** : `thiserror` dans les bibliothèques, `anyhow` uniquement dans les binaires et `xtask`. Jamais d'erreur avalée silencieusement.
- **Async** : Tokio. Aucun appel bloquant dans une tâche async (fichiers lourds, calcul PDF : `spawn_blocking`).
- **SQL** : macros `sqlx::query!` / `query_as!` vérifiées à la compilation, mode hors ligne (`cargo sqlx prepare --workspace`, dossier `.sqlx` commité). Jamais de SQL construit par concaténation.
- **Montants** : entiers en centimes (`i64`) ou type décimal exact. **Jamais de `f64` pour de l'argent.**
- **Dates** : une seule bibliothèque de dates dans tout le workspace, choisie en phase 0 et consignée. Instants stockés en UTC ; dates juridiques (délais, échéances) en dates civiles sans heure, fuseau Europe/Paris.
- **Journalisation** : `tracing`. Jamais de contenu métier ni de donnée personnelle dans les journaux (voir `00-mission`).
- **Chemins** : `PathBuf` et répertoires système via les API dédiées, jamais de séparateur écrit en dur.
- **Tests** : à côté du code (`#[cfg(test)]`) pour l'unitaire, dans `tests/` pour l'intégration contre de vrais services.
