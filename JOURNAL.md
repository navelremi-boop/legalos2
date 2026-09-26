# LEGAL OS — Journal (décisions et preuves)

Synthèse (relire `docs/ordre-operation.md`, `PLAN.md`, `BLOCAGES.md` à chaque reprise). Archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`.

- **Phase 0–1** : VALIDÉES (J0–J4). **Phase 2** : J5–J7 VALIDÉS. Coque livrée en code (`a24d0a2`) mais **non cochée** : l’architecte place J8 avant la Coque.
- **En cours** : **J8** (dettes sync soldées côté lot facturation — en attente contrôleur ; fausse alerte conflit J3 avant fin de phase 2).
- **Ordre déclaré** : J8 → Référence de dossier → Coque → Vue scindée → Intercalaires personnalisés → J9.
- **Gouvernance** : consignes de l’architecte = autorité de commandement (§ 7 ordre). Décisions d’architecture hors cahier → `BLOCAGES.md` « Décisions d’architecture en attente ».
- **Sync** : PowerSync Sync Streams édition 3 (`docs/sync-streams.md`, `sync-config.yaml`) ; JOIN ≤ 2 tables ; auth restreinte via `dossier_acces` + `auth.user_id()` ; tables enfants portent `dossier_id` + copie `visibilite`.
- **Délais** : hypothèses révisées implémentées (`0fc0c17`) ; `s8-delais.mjs` exit 0. Points H7/H10/H12 ouverts → B10.

---

## 2026-09-26 — J8 dettes sync / taux (lot facturation)

- `temps_saisis`, `brouillons_facture`, `taux_horaires` : migration `014`, Sync Streams (`temps_*` / `brouillons_*` / `taux_*`, JOIN ≤ 2), AppSchema, copie `visibilite` + trigger.
- Numéro nul jusqu’à validation serveur ; validation refuse dossier absent (ne crée jamais de dossier).
- Taux horaire paramétrable (`taux_horaires` + saisie poste) ; HT = minutes × taux / 60 (F0 révisée).
- Recettes : `s5-sync-streams.mjs` exit 0 ; `s9-s5-temps.mjs` exit 0 ; `s9-factures.mjs` exit 0. Preuve poste Tauri : `s9-poste-tauri.mjs` (à rejouer par le contrôleur si besoin).

## 2026-09-26 — Consignes du commandement (architecte)

Consignes reçues et appliquées : gouvernance § 7 ; archivage du journal par phase ; hygiène PLAN/BLOCAGES/versions ; réordonnancement (J8 d’abord) ; dettes antérieures dans `PLAN.md` ; sync sans JOIN ; F3 débours/frais ; délais H8–H11 + cinq cas s8. Gardes fail-closed + `tests/recette/garde-hooks.mjs`.

## 2026-09-26 — J8 en cours (reprise)

- Premier jalon non coché selon l’ordre architecte : **J8**. Dettes : sync PowerSync des temps et brouillons ; numéro nul jusqu’à validation ; rattachement à un dossier existant ; taux horaire paramètre (client, dossier, intervenant) ; fausse alerte conflit J3 avant fin de phase 2.
- Délais : `node tests/recette/s8-delais.mjs` exit 0 après H8–H11.

## 2026-09-26 — Coque : correction des écarts (avant validation)

Lot poste-interface. Jalon Coque **non coché**. Sync Streams / J8 non touchés.

- Onglets : réduction puis menu overflow (`BarreHaut`, `data-testid=onglets-overflow`).
- Titre La journée : jeton `--texte-sur-neutre` (#F2F5F4 jour et nuit) sur `.fond-neutre`.
- Chrono : `formatDuree` → « 0 h 12 » (§ 7.7).
- Barre d’actions : `@tabler/icons-react` 3.48.0 (contour).
- Jauge : « jours » sous le nombre.
- La journée : `JOURNEE_DEMO` en DEV/galerie (4 sections).
- Preuves : `node tests/recette/coque-app.mjs` exit 0 ; `--captures` exit 0 (`design/captures/journee-*.png` régénérées).
