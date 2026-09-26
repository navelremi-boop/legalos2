# LEGAL OS — Journal (décisions et preuves)

Synthèse (relire `docs/ordre-operation.md`, `PLAN.md`, `BLOCAGES.md` à chaque reprise). Archives : `docs/journal/phase-0.md`, `phase-1.md`, `phase-2.md`.

- **Phase 0–1** : VALIDÉES (J0–J4). **Phase 2** : J5–J7 VALIDÉS. Coque livrée en code (`a24d0a2`) mais **non cochée** : l’architecte place J8 avant la Coque.
- **En cours** : **J8** (dette sync `temps_saisis` / `brouillons_facture`, taux paramétrable, pas de création de dossier à la validation).
- **Ordre déclaré** : J8 → Référence de dossier → Coque → Vue scindée → Intercalaires personnalisés → J9.
- **Gouvernance** : consignes de l’architecte = autorité de commandement (§ 7 ordre). Décisions d’architecture hors cahier → `BLOCAGES.md` « Décisions d’architecture en attente ».
- **Sync** : PowerSync Sync Rules 1.26.1 sans JOIN ; tables rattachées à un dossier portent `dossier_id` + copie de visibilité (voir `docs/sync-rules.md`). Sync Streams lèvent les JOIN (`edition: 3`) — migration non engagée.
- **Délais** : hypothèses révisées implémentées (`0fc0c17`) ; `s8-delais.mjs` exit 0. Points H7/H10/H12 ouverts → B10.

---

## 2026-09-26 — Consignes du commandement (architecte)

Consignes reçues et appliquées : gouvernance § 7 ; archivage du journal par phase ; hygiène PLAN/BLOCAGES/versions ; réordonnancement (J8 d’abord) ; dettes antérieures dans `PLAN.md` ; sync sans JOIN ; F3 débours/frais ; délais H8–H11 + cinq cas s8. Gardes fail-closed + `tests/recette/garde-hooks.mjs`.

## 2026-09-26 — J8 en cours (reprise)

- Premier jalon non coché selon l’ordre architecte : **J8**. Dettes : sync PowerSync des temps et brouillons ; numéro nul jusqu’à validation ; rattachement à un dossier existant ; taux horaire paramètre (client, dossier, intervenant) ; fausse alerte conflit J3 avant fin de phase 2.
- Délais : `node tests/recette/s8-delais.mjs` exit 0 après H8–H11.
