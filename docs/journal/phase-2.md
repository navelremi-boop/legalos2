# LEGAL OS — Journal archive — Phase 2

## 2026-09-25 — J5, dossiers et droits

- Tables `dossiers`, `parties`, `dossier_acces`. Création dans l'app (chemise, partie, juridiction, n° RG, case restreint) puis envoi à l'API. Palette : recherche par nom, n° RG, juridiction ou partie.
- PowerSync 1.26.1 refuse les jointures et les conversions dans les paramètres. Les dossiers publics suivent `visibilite = 'public'`. Les dossiers restreints ne descendent que si `dossier_acces.utilisateur_texte` est l'utilisateur du jeton.
- `node tests/recette/j5-poste-tauri.mjs` : exit 0. `OK — dossier retrouvé par la palette`. `OK — dossier restreint absent du SQLite de B`.
- CI `340ac42` (run [36172577399](https://github.com/navelremi-boop/legalos2/actions/runs/36172577399)) : **verte**.
- Contrôleur [J5](b9bba862-c3a6-4656-96e7-98c9a6987099) : **VALIDÉ** sur `340ac42`. Recette rejouée exit 0. SQLite du poste B : aucun dossier `restreint = 1`. Le seau public filtre `visibilite = 'public'` ; le seau restreint passe par `dossier_acces`. J5 coché. Prochain jalon : J6.

## 2026-09-25 — J6, délais

- Moteur `apps/poste/src/delais/moteur.mjs` : articles 640 à 644 (jours, mois, quantième manquant, report au jour ouvrable, mois de distance). Jours fériés métropolitains, Pâques par l'algorithme grégorien. Chaque règle est dans `docs/hypotheses-delais.md`, marquée « à valider par l'avocat ».
- `node tests/recette/s8-delais.mjs` : `s8: OK — jeu de cas des délais`. Le script est dans le job CI `frontend`. L'écran « La journée » calcule une échéance. L'agenda complet (audiences, rendez-vous) n'est pas dans ce jalon.
- CI `bf3bfe3` (run [36179592258](https://github.com/navelremi-boop/legalos2/actions/runs/36179592258)) : **verte**.
- Contrôleur [J6](95b16069-8a4c-4c78-8aa3-f9509cb6f721) : **VALIDÉ** sur `bf3bfe3`. `node tests/recette/s8-delais.mjs` exit 0, y compris après le durcissement qui exige le marqueur sur H1–H8. Aucune règle hors hypothèses. J6 coché. Prochain jalon : J7.

## 2026-09-25 — J7, documents

- Métadonnées `documents` et `document_versions` dans Postgres. Contenu dans Garage via OpenDAL 0.59.3 : lien de dépôt signé, puis scellement qui relit l'objet et vérifie l'empreinte. Une modification crée la version suivante sans remplacer la précédente.
- `node tests/recette/s6-documents.mjs` : `document déposé et ouvert` puis `OK — nouvelle version renvoyée, version précédente conservée`.
- CI `2eb7266` (run [36183981852](https://github.com/navelremi-boop/legalos2/actions/runs/36183981852)) : **verte**.
- Contrôleur [J7](6acf8035-815d-47c6-9e4d-2854c328ac4c) : **VALIDÉ** sur `2eb7266`. Recette rejouée exit 0. Clés `v1` et `v2` distinctes, contenus conservés sur Garage. Écarts majeurs non bloquants : métadonnées absentes des règles PowerSync ; un second `POST /documents` du même id peut réémettre un dépôt sur la clé v1. J7 coché. Prochain jalon : J8.

## 2026-09-25 — J8 commencé

- Brouillon, validation avec numéro continu (une séquence par cabinet), facture validée immuable en base, avoir sur la même séquence, dépôt idempotent sur le simulateur, encaissement partiel de 6 000 centimes sans doublon.
- `node tests/recette/s9-factures.mjs` : exit 0. `numéros continus attribués par le serveur` ; `dépôt répété, une seule fiche plateforme` ; `encaissement partiel, 6000 centimes, sans doublon` ; `avoir numéroté, facture validée non renumérotée`.
- Hypothèses de taux, d'arrondi et de débours dans `docs/hypotheses-facturation.md`, marquées « à valider par l'avocat ».
- Contrôleur [J8](b1c52efe-2669-413f-bc93-6833ac28d718) : **REFUSÉ**. Manquaient les temps, le brouillon hors ligne, et le jeu § 3.7.
- Ensuite : six XML CII (professionnel, particulier, avoir, acompte, débours, paiement partiel) passent le schematron ; `s9-facturx.mjs` et `s9-factures.mjs` exit 0. Le brouillon hors ligne est une base SQLite locale sans numéro, écrite sans appel API. Pas encore l'écran Tauri. J8 non coché.

## 2026-09-26 — J8, temps sur le poste

- Écran « Saisir du temps » : la minute est enregistrée dans le SQLite du poste (`temps_saisis`, `brouillons_facture`) sans appel API, numéro nul. Hypothèse F0 : 100 centimes par minute, marquée « à valider par l'avocat ».
- « Valider en ligne » crée le dossier, le brouillon et la ligne d'honoraires, puis le serveur attribue le numéro et sert le CII.
- `node tests/recette/s9-poste-tauri.mjs` : exit 0. `temps saisi, brouillon local sans numéro, puis numéro serveur`.
- `node tests/recette/s9-factures.mjs` : exit 0, y compris `Factur-X produit après validation` (`GET /factures/{id}/cii`).
- `node tests/recette/s9-facturx.mjs` : exit 0 (six cas + PDF/A-3b).
- Image API reconstruite pour exposer le CII. J8 non coché : pas encore de nouveau verdict contrôleur ni de CI sur ce commit.
- Contrôleur [J8](80f27e83-84d3-488d-8a7f-cc1f2fc67ee2) : **REFUSÉ** sur `d7c274e`. Temps, brouillon hors ligne et jeu § 3.7 rejoués (exit 0). Bloquant : `UPDATE` des lignes d'une facture validée réussissait. La CI de ce commit n'existait pas encore.
- Migration `012_lignes_immuables.sql` : insertion, modification et suppression des lignes refusées dès que la facture est validée. `node tests/recette/s9-factures.mjs` : `facture validée immuable (entête et lignes)`. J8 non coché.

## 2026-09-26 — Cahier version 5, J7 rouvert

- `docs/cahier-des-charges.md` remplacé par la version 5 du 26 septembre 2026 (chemise ouverte, référence de dossier, intercalaires). Le prototype déjà dans `design/prototype-cabinet.html` correspond à cette version.
- J7 décoché : réécrire un objet déjà scellé touchait l'invariant d'absence d'écrasement. L'API répond 409 si la version est scellée ou si l'objet est déjà visible. Garage 1.0.1 refuse `If-None-Match` et répond 403 à un `HeadObject` sur une clé absente : pas d'écriture conditionnelle possible sur ce service. Les métadonnées des documents sont dans les règles PowerSync, filtrées comme le dossier.
- Le nœud Garage n'avait plus de rôle ni de clé. Layout, seau `legalos` et clé d'API recréés localement. Le secret n'est pas dans le dépôt.
- `node tests/recette/s6-documents.mjs` : exit 0.
- CI `5ff58b9` (run [36232407821](https://github.com/navelremi-boop/legalos2/actions/runs/36232407821)) : **verte**.
- Contrôleur [J7](bf3aff8a-2345-41ad-8394-293bdcf65004) : **VALIDÉ** sur `5ff58b9`. Recette rejouée exit 0. Après dépôt et après scellement, un nouveau dépôt de la version 1 est refusé (409). Mineur : un `HeadObject` refusé est traité comme une clé absente. J7 coché. Prochain jalon : Coque de l'app.

## 2026-09-26 — Coque de l'app

- Jetons § 7.3 : huit chemises à quatre valeurs jour et nuit, fond `neutre`, tuile `design/grain.svg`, halos `--lumiere`.
- Composants : barre du haut, étiquette avec référence, informations, jauge, feuille, intercalaires standards, barre d'actions. Écrans La journée (fond neutre, quatre sections), Dossier ouvert, Dossiers, Réglages ; stubs Mails, Agenda, Facturation. Galerie DEV (`?galerie=1`).
- Fonctions branchées : nouveau dossier (palette et Dossiers), saisie de temps et calcul de délai depuis la barre d'actions, nom du cabinet et thème dans Réglages. Indicateur de sync (point + libellé), sans bascule en ligne / hors ligne.
- `node tests/recette/coque-app.mjs` : exit 0. Captures jour et nuit (trois chemises + La journée) sous `design/captures/`, avec barre du haut, après stabilisation de la couleur de chemise.
- Graisse 800 : ExtraBold absente, Bold déclarée pour `font-weight: 800`. Vue scindée hors périmètre (jalon suivant).

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

## 2026-09-26 — J8 VALIDÉ

- Contrôleur sur `e8eb6b2` (CI `36269667975`) : **VALIDÉ**. Revue 31-facturation OK.
- Correctifs majeurs soldés (PDF/CII validation, CII débours, avoir+lignes, e-reporting).

## 2026-09-26 — Référence de dossier (démarrage)

- Jalon § 3.4 : année + numéro continu cabinet, serveur, unicité, hors ligne « référence en attente ».

## 2026-09-26 — Référence de dossier (poste)

- **Schéma** : `AppSchema` colonne `dossiers.reference` (text, nullable) ; index `reference`.
- **UI** : `libelleReferenceDossier` → « en attente » si null/vide ; étiquette, onglets (`data-reference`), palette, liste.
- **Écriture** : `ecrireDossier` INSERT `reference = NULL` — jamais générée côté poste.
- **Sync UI** : `CoqueApp` poll SQLite toutes les 2 s pour remplacer « en attente » dès attribution serveur.
- **Recettes** : `tests/recette/reference-dossier.mjs` ; extensions `coque-app.mjs` + `j5-poste-tauri.mjs` (NULL local ; YYYY-… si colonne serveur présente, sinon report backend parallèle).
- Preuves : `pnpm --filter @legal-os/poste typecheck` → OK ; `lint:ci` → OK ; `node tests/recette/reference-dossier.mjs` → OK ; `node tests/recette/coque-app.mjs` → OK.

## 2026-09-26 — Référence de dossier (API / Postgres)

- **Migration** `016_dossier_reference.sql` : `reference` / `reference_annee` / `reference_numero` nullable ; `sequences_dossiers (cabinet_id, annee)` ; UNIQUE partiels ; déclencheur d'immutabilité.
- **Attribution** : `POST /dossiers` en transaction — année civile Europe/Paris, `INSERT … ON CONFLICT DO UPDATE … RETURNING`, format `YYYY-NNN` (R0, `docs/hypotheses-dossiers.md`).
- **OpenAPI** : `DossierResponse.reference: Option<String>`. **Sync Streams** : `reference` dans `dossiers_publics` / `dossiers_restreints` ; garde `s5-sync-streams.mjs`.
- Décision : largeur minimale 3 chiffres (ex. `2026-042`) ; au-delà de 999 sans tronquer — consignée en R0.
- Preuves : `cargo clippy -p legalos-api --all-targets -- -D warnings` → exit 0 ; `cargo test -p legalos-api --lib -- routes::dossiers::tests` → 2 ok ; `node tests/recette/reference-dossier-api.mjs` → OK ; `node tests/recette/s5-sync-streams.mjs` → OK.

## 2026-09-26 — Référence de dossier (état-major : libellé et preuve hors ligne)

- **Libellé** aligné sur le cahier § 3.4 : « Référence en attente » ; étiquette « Dossier 2026-042 » ou « Référence en attente ».
- **Coupure réelle** dans j5 : `docker compose pause api powersync`, création d’un dossier sur le poste → SQLite `reference` NULL, palette « Référence en attente », toujours NULL après 3 s ; `unpause` → référence serveur en SQLite et dans la palette.
- **Encodage** : cinq lignes du journal écrites en ANSI par `Add-Content` (commit `c26b709`) réparées en UTF-8. **Règle vivante** `.cursor/rules/05-encodage.mdc` + contrôle `tests/recette/encodage-texte.mjs` en CI ; BOM retiré de `.cargo/config.toml`.
- Preuves : typecheck, `lint:ci`, `reference-dossier.mjs`, `coque-app.mjs`, `reference-dossier-api.mjs` → OK ; `node tests/recette/j5-poste-tauri.mjs` → exit 0 (dossier hors ligne « Référence en attente » puis **2026-006** au retour du réseau).

## 2026-09-28 — Conflits généralisés VALIDÉ

- API déjà sur `main` (`5fbac31`) : journal en trois flux, PATCH par champ, immutabilité d'un temps référencé par un brouillon numéroté, `CHECK` restreint/visibilité.
- Poste (`9f6e137`, puis drapeau de reconnexion `5c16e47`) : connecteur PUT/PATCH/DELETE, refus dans `refus_sync`, signal dans l'app. Recettes `conflits-poste-tauri.mjs` et `j3-poste-tauri.mjs` vertes.
- Premier contrôle REFUSÉ : `conflits_integration` rejouait des clés fixes sur le Postgres partagé (`journal dossier: RowNotFound`). Correctif `ad83917` : série unique par exécution, rejeu volontaire de la même clé. Recontrôle : exit 0, 1 passed.
- Critères du PLAN inchangés depuis `c47dc6b` jusqu'à la coche. CI de `main` [36357904754](https://github.com/navelremi-boop/legalos2/actions/runs/36357904754) verte. Minutes des quatre runs du lot (lint en échec, lint corrigé, clés, `main`) : **78**.
- Dettes jusqu'à la fin de la phase 2 : `fixerRevisionEdition` pour la fausse alerte ; insertion de secours dans `ps_crud`.

## 2026-09-28 — Coque de l'app VALIDÉE

- Poste `64cdb1b` : onglets vides au démarrage, dossiers réels, sonde `/health` (coupure → « Hors ligne, N modifications en attente », puis « Synchronisé »), overflow vers 800 px, galerie absente du build, captures jour et nuit.
- CORS `958d09a` : `tauri://localhost` toujours ; `localhost:1420` et `127.0.0.1:1420` seulement en `LEGALOS_MODE=development`.
- Contrôleur VALIDÉ. CI de `main` [36475104465](https://github.com/navelremi-boop/legalos2/actions/runs/36475104465). Minutes des trois runs (PR CORS, PR poste, `main`) : **60**.
- Observation : La journée en développement garde un jeu fictif pour les captures ; le build distribué a des listes vides jusqu'à J10. Le chrono détaillé reste au jalon Vue scindée.

## 2026-09-29 — Vue scindée VALIDÉE

- Premier contrôle REFUSÉ : `vue-scindee-tauri.mjs` s'arrêtait sur la coque hors session, formulaire sans responsable.
- Correctif `c0cfa49` : reconnexion par le menu Compte, formulaire qui attend le responsable. Recontrôle : exit 0, `vue-scindee: OK`.
- CI de `main` [36531714153](https://github.com/navelremi-boop/legalos2/actions/runs/36531714153). Minutes des trois runs (PR, correctif, `main`) : **62**.
- Dette : `CHRONO_DEMO` reste le contenu par défaut d'un dossier réel, à remplacer par les éléments synchronisés avant la fin de J9 et de Documents, suite.
- Même fusion : dettes de preuve des conflits soldées (`f393190`) — plus d'insertion de secours dans `ps_crud`, plus de `fixerRevisionEdition`.
