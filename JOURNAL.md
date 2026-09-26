# LEGAL OS — Journal (décisions et preuves)

Synthèse (archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`).

- **Phase 0–1** VALIDÉES ; **J5–J7** VALIDÉS ; **Migration Sync Streams** VALIDÉE `9f80388`.
- **En cours** : **J8** — temps et facturation (S9) ; contrôleur + revue `31-facturation`.
- **Ordre** : ~~Migration Sync Streams~~ → **J8** → Référence → Coque → Vue scindée → Intercalaires → J9.
- **Sync** : Streams édition 3, service 1.26.1. GHSA-q6wc-xx4m-92fj + 1.23.3. Dette mensuelle avis PowerSync.
- **Coque** corrigée (`22d765e`), non cochée (après Référence).

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
- Contrôleur sur `9f80388` (CI `36265441004`) : **VALIDÉ**.

## 2026-09-26 — J8 (repris après Streams VALIDÉ)

- Code déjà sur main (`c34a033` / `07a7ff7` / `a00e56d`) : migration 014, flux temps/brouillons/taux, S9.
- Inventaire OK. Écart règle 31 : pas d’interface `PlateformeAgreee` (appels `reqwest` directs) ; S9 ne poussait pas jusqu’au statut « encaissée » total.
- Correctifs : `crates/api/src/plateforme.rs` (trait + `HttpPlateformeAgreee` idempotent) ; routes `emettre`/`encaisser` branchées ; simulateur `/v1/e-reporting` + `/v1/annuaire/{siren}` ; `s9-factures` vérifie règlement 2×6000 → `encaissee` 12000 ; migration 014 en LF (checksum sqlx local aligné).
- Preuves (2026-09-26) :
  - `cargo clippy -p legalos-api --all-targets -- -D warnings` → exit 0
  - `cargo test -p legalos-api plateforme` → 2 ok
  - `node tests/recette/s9-factures.mjs` → OK (dont encaissée 12000)
  - `node tests/recette/s9-facturx.mjs` → schematron 6 cas + PDF/A-3b OK
  - `node tests/recette/s9-s5-temps.mjs` → OK
  - `node tests/recette/s9-poste-tauri.mjs` → OK (temps hors ligne → numéro serveur)
- Conformité 31 : centimes ; numérotation transactionnelle ; immutabilité entête+lignes (012) ; Factur-X ; PA idempotente via trait ; débours/frais (F3) ; hypothèses F0–F6. J8 non coché (contrôleur).

## 2026-09-26 — J8 recontrôle (écarts majeurs PDF/CII, lire_cii, avoir, e_reporter)

Contrôleur REFUSÉ sur `7d45cef`. Correctifs majeurs :

1. **PDF + Factur-X à la validation** : `assurer_artefacts` après `POST /factures/{id}/valider` (et avoir) génère le CII Rust, compile PDF/A-3b via binaire Typst (`spawn_blocking`), stocke dans `facture_artefacts` ; `GET /factures/{id}/cii` et `…/pdf`. Migration `015`. Typst 0.14.0 dans l'image API (F7).
2. **`lire_cii`** : débours = somme des lignes `nature=debours` ; déjà payé = somme des encaissements ; HT taxable = total − débours ; artefact figé (plus de zéros forcés).
3. **Avoir** : création en brouillon → copie des `facture_lignes` → validation + numéro (contourne le déclencheur d'immutabilité).
4. **e_reporter** : `emettre` branche `particulier`/`etranger` sur `PlateformeAgreee::e_reporter` ; stub `GET /annuaire/{siren}` (F8).

Recette `s9-factures.mjs` : télécharge PDF+CII API → schematron + veraPDF ; débours ; e-reporting ; lignes d'avoir.

Preuves (2026-09-26) :
- `cargo clippy -p legalos-api --all-targets -- -D warnings` → exit 0
- `cargo test -p legalos-api --lib` → 11 ok
- `node tests/recette/s9-factures.mjs` → OK (PDF+CII API schematron+veraPDF ; débours ; e-reporting ; lignes avoir)
- `node tests/recette/s9-facturx.mjs` → OK (6 cas schematron + PDF/A-3b)
