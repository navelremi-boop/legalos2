# Hypothèses — facturation

Validation provisoire de l'architecte le 27/09/2026 : F0 à F8 sont retenues. La revue par l'avocat avant toute mise en service réelle reste ouverte (B10, dette « Avant J17 »). Le cahier § 3.7 impose les centimes, l'arrondi EN 16931 par catégorie, la numérotation serveur, l'immutabilité et l'avoir.

## F0 — Taux horaire paramétrable

Le montant HT d'une saisie est `(minutes × taux_centimes_heure) / 60` (division entière). Le taux vient de la table `taux_horaires` (paramètre par client, dossier et/ou intervenant), ou d'une saisie explicite sur le poste — **pas** d'une constante unique dans le code de validation. Le brouillon n'a pas de numéro tant que le serveur ne l'a pas validé. En l'absence de paramètre, le formulaire propose 6 000 centimes/heure (60 €/h) pour les jeux de cas. **À valider par l'avocat.**

## F1 — Taux normal

Les honoraires et les frais du jeu de cas sont soumis au taux de 20,00 % (2 000 points de base). **À valider par l'avocat.**

## F2 — Arrondi de la TVA

La TVA d'une catégorie est `(base_ht_centimes × taux_points_de_base + 5 000) / 10 000`, division entière. Cas : 100,00 € → 20,00 € ; 10,01 € → 2,00 € ; 10,03 € → 2,01 €. **À valider par l'avocat.**

## F3 — Deux types de ligne : débours et frais

Deux types distincts :

- **Débours** : hors base de TVA ; réservés aux dépenses engagées **au nom et pour le compte du client** et justifiées. Ils entrent dans le total à payer sans TVA.
- **Frais** : soumis à la TVA (même régime de taux et d’arrondi que les honoraires, F1–F2).

**Retenu par l'architecte (27/09/2026)**, dans cette version corrigée : les débours sont hors TVA, les frais y sont soumis.

## F4 — Une seule séquence

Factures et avoirs partagent la même séquence continue du cabinet. **À valider par l'avocat.**

## F5 — Identités du XML

Vendeur « Cabinet fictif LEGAL OS », SIREN 123456789, n° TVA FR32123456789, acheteur « Client fictif », IBAN de test. Ce ne sont pas des données réelles. **À valider par l'avocat** pour un vrai cabinet.

## F6 — Profil CII

Le XML suit la syntaxe CII D16B et l'identifiant `urn:cen.eu:en16931:2017`, validé par le schematron CEN EN 16931 1.3.16 (XSLT précompilé, licence EUPL 1.2). Le PDF lisible est un PDF/A-3b Typst 0.14.0 avec `factur-x.xml` en pièce jointe `alternative`, contrôlé par veraPDF 1.28.2. Le jeu couvre professionnel, particulier, avoir, acompte, débours et paiement partiel. **À valider par l'avocat.**

## F7 — Typst hors processus API

Typst n'est pas une bibliothèque liée dans le binaire Rust de l'API : à la validation, l'API invoque le **binaire** Typst 0.14.0 (`LEGALOS_TYPST` / `TYPST` / `/usr/local/bin/typst`) en `spawn_blocking`, joint le CII généré en Rust, et stocke PDF + XML dans `facture_artefacts` (récupérables via `GET /factures/{id}/pdf` et `…/cii`). L'image `legalos/api` embarque ce binaire. Sans Typst, la validation échoue après attribution du numéro (reprise possible par nouvel appel `valider`, qui régénère les artefacts manquants). Alternative écartée : génération PDF pure Rust (`lopdf`) — PDF/A-3b + pièce jointe Factur-X trop fragile pour V1. Choix technique retenu par l'architecte le 27/09/2026.

## F8 — Type client et canal d'émission

`type_client` sur la facture : `professionnel` → dépôt Factur-X sur la PA ; `particulier` ou `etranger` → `PlateformeAgreee::e_reporter` (pas de facture électronique, cahier § 3.7). L'annuaire PA est exposé en stub `GET /annuaire/{siren}`. **Retenu par l'architecte (27/09/2026).** Les clients publics (Chorus Pro) ne sont pas couverts ; c'est un point ouvert du cahier § 6.
