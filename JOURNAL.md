# LEGAL OS — Journal (décisions et preuves)

Synthèse (archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`).

- **Phase 0–1** VALIDÉES ; **J5–J7** VALIDÉS. Coque corrigée (`22d765e`), non cochée.
- **En cours** : **Migration Sync Streams** — contrôleur **REFUSÉ** sur `a00e56d` (S5 SQLite) ; correctif j5 + `s5-sqlite-par-flux` ; revalidation en cours.
- **Ordre** : Migration Sync Streams → J8 → Référence → Coque → Vue scindée → Intercalaires → J9.
- **Sync** : Streams édition 3, service 1.26.1. GHSA-q6wc-xx4m-92fj + 1.23.3 dans `docs/versions.md`. Dette mensuelle avis PowerSync.
- **J8 code** déjà sur main (`c34a033`) mais **après** Sync Streams sans VALIDÉ contrôleur Streams — à traiter une fois Streams VALIDÉ.

---

## 2026-09-26 — Consignes architecte (Sync Streams, règles, Coque)

1. Migration Sync Streams avant nouvelles tables J8 ; jalon dédié ; contrôleur avant reprise J8.
2. Globs `31-facturation` corrigés (reste dans `crates/api`) ; CI `cursor-rules-globs.mjs` ; revue 31 au contrôleur.
3. Écarts Coque corrigés (`22d765e`) : onglets overflow, titre `#F2F5F4`, chrono « 0 h 12 », icônes, jauge « jours », captures démo B9.

## 2026-09-26 — S5 SQLite par flux (correction refus contrôleur)

- Écart : `s9-s5-temps.mjs` prouvait l’absence via JOIN Postgres, pas SQLite poste ; `docs/sync-streams.md` citait faussement cette recette ; j5 SELECT docs/versions sans dépôt de pièce (assertion vacueuse).
- Correctif : `j5-poste-tauri.mjs` dépose pièce (API `/documents` + empreinte) + temps + brouillon sur le dossier restreint, puis vérifie absence dans `legalos-powersync-b.db` pour dossiers, documents, document_versions, temps_saisis, brouillons_facture. Doc corrigée. Acceptation `s5-sqlite-par-flux.mjs` OK.
- Preuve : `node tests/recette/s5-sqlite-par-flux.mjs` → OK ; `node tests/recette/j5-poste-tauri.mjs` → OK (enfants absents du SQLite de B).

## 2026-09-26 — Migration Sync Streams

- `60b9837` / `5f46967` : sync-config edition 3, docs/sync-streams.md.
- Contrôleur sur `5f46967` : **REFUSÉ** — GHSA absent du commit (présent ensuite dans WT / `22d765e`).
- Contrôleur sur `a00e56d` (CI verte `36262734653`) : **REFUSÉ** — S5 SQLite incomplet (temps/brouillons Postgres seul ; docs/versions vacueux ; doc trompeuse).
- Correctif : j5 dépôt réel + SQLite B pour cinq flux ; `s5-sqlite-par-flux.mjs` en CI ; `docs/sync-streams.md` corrigé.
- Preuves locales : `s5-sqlite-par-flux` OK ; `j5-poste-tauri` OK ; `s5-sync-streams` OK ; j3-liveness via CI.

## 2026-09-26 — J8 sync temps (code poussé, hors ordre contrôleur Streams)

- `c34a033` / `07a7ff7` : migration 014, flux temps/brouillons/taux, S5. À valider **après** VALIDÉ Migration Sync Streams.
