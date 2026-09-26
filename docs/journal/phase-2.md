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
