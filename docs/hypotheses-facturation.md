# Hypothèses — facturation

Chaque règle ci-dessous est **à valider par l'avocat**. Le cahier § 3.7 impose les centimes, l'arrondi EN 16931 par catégorie, la numérotation serveur, l'immutabilité et l'avoir. Le taux et le sort des débours ne sont pas fixés par le cahier.

## F1 — Taux normal

Les honoraires et les frais du jeu de cas sont soumis au taux de 20,00 % (2 000 points de base). **À valider par l'avocat.**

## F2 — Arrondi de la TVA

La TVA d'une catégorie est `(base_ht_centimes × taux_points_de_base + 5 000) / 10 000`, division entière. Cas : 100,00 € → 20,00 € ; 10,01 € → 2,00 € ; 10,03 € → 2,01 €. **À valider par l'avocat.**

## F3 — Débours

Un débours n'entre pas dans la base de TVA. Il entre dans le total à payer. **À valider par l'avocat.**

## F4 — Une seule séquence

Factures et avoirs partagent la même séquence continue du cabinet. **À valider par l'avocat.**

## Hors périmètre prouvé

PDF/A-3b, XML CII, veraPDF et schematron EN 16931 ne sont pas encore exécutés. Le jalon J8 reste ouvert tant que ce maillon manque.
