# LEGAL OS — Journal (décisions et preuves)

Synthèse (relire `docs/ordre-operation.md`, `PLAN.md`, `BLOCAGES.md` à chaque reprise). Archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`.

- **Phase 0–1** : VALIDÉES (J0–J4). **Phase 2** : J5–J7 VALIDÉS. Coque livrée en code (`a24d0a2`) mais **non cochée** : l’architecte place J8 avant la Coque.
- **En cours** : **J8** (dettes sync temps/brouillons/taux adaptées Sync Streams — en attente contrôleur ; fausse alerte conflit J3).
- **Ordre déclaré** : J8 → Référence de dossier → Coque → Vue scindée → Intercalaires personnalisés → J9.
- **Gouvernance** : consignes de l’architecte = autorité de commandement (§ 7 ordre). Décisions d’architecture hors cahier → `BLOCAGES.md` « Décisions d’architecture en attente ».
- **Sync** : PowerSync **Sync Streams** édition 3 (`instance/powersync/sync-config.yaml`, service 1.26.1) — JOIN autorisés (≤ 2 tables) ; auth restreinte via `dossier_acces` + `auth.user_id()` ; voir `docs/sync-streams.md`. Colonne `visibilite` sur les enfants conservée en SELECT, non utilisée pour filtrer les flux restreints.
- **Délais** : hypothèses révisées implémentées (`0fc0c17`) ; `s8-delais.mjs` exit 0. Points H7/H10/H12 ouverts → B10.

---

## 2026-09-26 — J8 dettes sync / taux (lot facturation, après Sync Streams)

- `temps_saisis`, `brouillons_facture`, `taux_horaires` : migration `014` ; flux Sync Streams (JOIN `dossiers` / `dossier_acces`) ; AppSchema.
- Numéro nul jusqu’à validation ; validation refuse dossier absent.
- Taux horaire paramétrable ; HT = minutes × taux / 60 (F0).
- Recettes : `s9-factures.mjs`, `s9-poste-tauri.mjs`, `s9-s5-temps.mjs` ; `s5-sync-streams.mjs` étendu.

## 2026-09-26 — Consignes du commandement (architecte)

Consignes reçues et appliquées : gouvernance § 7 ; archivage du journal par phase ; hygiène PLAN/BLOCAGES/versions ; réordonnancement (J8 d’abord) ; dettes antérieures dans `PLAN.md` ; sync sans JOIN ; F3 débours/frais ; délais H8–H11 + cinq cas s8. Gardes fail-closed + `tests/recette/garde-hooks.mjs`.

## 2026-09-26 — Migration Sync Streams (avant reprise J8)

- Décision architecte : migrer Sync Rules → **Sync Streams édition 3** avant de reprendre J8. Stash J8 `wip-j8-avant-sync-streams` **non** appliqué.
- Déploiement : `sync-config.yaml` (`auto_subscribe: true` sur tous les flux) ; `service.yaml` → `sync_config.path` ; compose monte `sync-config.yaml` ; `sync-rules.yaml` et `docs/sync-rules.md` retirés.
- Contrat : `docs/sync-streams.md` ; règle Cursor `13-synchronisation.mdc` mise à jour.
- Tests : `s5-sync-streams.mjs` (statique par flux) ; `s6-documents.mjs` adapté ; `j5-poste-tauri.mjs` adapté Coque (formulaire dossier) + SQLite B vide pour dossiers/parties/documents/versions.
- Preuves 2026-09-26 : `s5-sync-streams.mjs` exit 0 ; `s6-documents.mjs` exit 0 ; `j5-poste-tauri.mjs` exit 0 ; `j3-powersync-liveness.mjs` exit 0. PowerSync logs : `powersync_3`, buckets `3#…`.
- Écart : WIP J8 (stash `wip-j8-avant-sync-streams`) non appliqué ; tables `temps_saisis` orphelines éventuelles en base locale de dev non référencées par les flux.
