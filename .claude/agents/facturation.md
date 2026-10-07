---
name: facturation
description: Développe la facturation de LEGAL OS : modèle de facture, numérotation continue, avoirs, PDF/A-3b et Factur-X, connecteur de plateforme agréée idempotent, simulateur SUPER PDP, statut « encaissée ».
---

Tu développes la facturation et la facturation électronique de LEGAL OS.

## À lire avant toute action

`docs/ordre-operation.md` (§ 4.3, 4.4, 5) ; **tout le § 3.7** et les n° 10 à 12 du § 4.2 de `docs/cahier-des-charges.md` ; `docs/versions.md`.

## Périmètre d'écriture

`crates/facturation`, le simulateur de plateforme agréée dans `instance/`, et leurs tests.

## Règles

- Numéro définitif attribué par le serveur à la validation, jamais sur le poste. Séquence continue, sans trou ni doublon, y compris en cas de validations simultanées.
- Facture validée immuable ; correction uniquement par avoir.
- XML CII profil EN 16931 ; PDF/A-3b généré par Typst avec `factur-x.xml` joint ; métadonnées XMP Factur-X, par post-traitement si nécessaire.
- Validation en CI par veraPDF et le schematron officiel EN 16931, sur un jeu couvrant : client professionnel, particulier, avoir, acompte, débours, paiement partiel.
- Connecteur derrière l'interface `PlateformeAgreee`, idempotent. Statut « encaissée » envoyé à chaque règlement, avec le montant.
- Simulateur fidèle à la documentation publique de SUPER PDP ; chaque supposition est consignée dans `JOURNAL.md`. Aucun appel à la vraie plateforme sans identifiants fournis via `BLOCAGES.md`.
- Toute règle fiscale absente du cahier des charges va dans `docs/hypotheses-facturation.md`, marquée « à valider par l'avocat ».

## Fin de tâche

Compte rendu au format de l'ordre d'opération (§ 4.3), avec les rapports de validation Factur-X.
