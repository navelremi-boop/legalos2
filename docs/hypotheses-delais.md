# Hypothèses — délais de procédure

Chaque règle ci-dessous est **à valider par l'avocat**. Aucune n'est présentée comme une interprétation définitive. Les sources citées ont été lues le 2026-09-25 (Légifrance n'a pas renvoyé le texte intégral à cause d'un contrôle anti-robot ; le texte retenu est celui des pages publiques du chapitre et de l'article, recoupées). Le jeu de cas automatique est `tests/recette/s8-delais.mjs`.

## H1 — Point de départ (art. 640)

Le délai a pour origine la date de l'acte, de l'événement, de la décision ou de la notification qui le fait courir.

Source : code de procédure civile, art. 640. **À valider par l'avocat.**

## H2 — Délai en jours (art. 641, al. 1)

Le jour de l'acte ne compte pas. Un délai de N jours expire le N-ième jour qui suit l'origine.

Cas : origine 10 janvier 2024, 15 jours → 25 janvier 2024.

Source : art. 641, al. 1. **À valider par l'avocat.**

## H3 — Délai en mois ou en années (art. 641, al. 2)

Le délai expire le jour du dernier mois ou de la dernière année qui porte le même quantième. À défaut, il expire le dernier jour du mois.

Cas : 31 janvier 2024 + 1 mois → 29 février 2024 ; 31 janvier 2023 + 1 mois → 28 février 2023 ; 15 mars 2024 + 1 mois → 15 avril 2024.

Le moteur n'a pas encore de durée en années. La même règle de quantième est celle qui sera appliquée. **À valider par l'avocat.**

## H4 — Mois puis jours (art. 641, al. 3)

Les mois sont décomptés d'abord (H3), puis les jours (H2 : le jour atteint par les mois ne compte pas).

Cas : 15 janvier 2024 + 1 mois et 10 jours → 25 février 2024, puis report (H6) au 26 février 2024.

Source : art. 641, al. 3, tel que publié sur Légifrance (page de l'article 641). **À valider par l'avocat.**

## H5 — Expiration à vingt-quatre heures (art. 642, al. 1)

Le délai expire le dernier jour à vingt-quatre heures. Le moteur ne manipule que des dates, pas des heures.

Source : art. 642, al. 1. **À valider par l'avocat.**

## H6 — Report au premier jour ouvrable (art. 642, al. 2)

Un délai qui expirerait un samedi, un dimanche ou un jour férié ou chômé est prorogé jusqu'au premier jour ouvrable suivant. Les jours non ouvrables consécutifs sont enchaînés.

Cas : origine 15 mars 2024, 1 jour → samedi 16 mars → lundi 18 mars 2024. Origine 30 mars 2024, 1 jour → dimanche 31 mars puis lundi de Pâques 1er avril → mardi 2 avril 2024. Origine 30 avril 2024, 1 jour → mercredi 1er mai → jeudi 2 mai 2024.

Source : art. 642, al. 2. **À valider par l'avocat.**

## H7 — Jours fériés retenus

Liste métropolitaine du code du travail, art. L. 3133-1 : 1er janvier, lundi de Pâques, 1er mai, 8 mai, Ascension, lundi de Pentecôte, 14 juillet, 15 août, 1er novembre, 11 novembre, 25 décembre.

Le dimanche de Pâques est calculé par l'algorithme grégorien de Meeus. Ascension = Pâques + 39 jours. Lundi de Pentecôte = Pâques + 50 jours. Vérifié pour 2020, 2024, 2025 et 2026.

Ne sont pas inclus : les jours propres à l'Alsace-Moselle, ni un calendrier ultramarin. **À valider par l'avocat.**

## H8 — Augmentation pour la distance (art. 643 et 644)

L'augmentation est un nombre de mois ajouté aux mois du délai, avant le décompte des jours et avant le report de l'article 642.

- Juridiction en France métropolitaine, personne qui demeure dans une collectivité visée à l'art. 643, 1° : + 1 mois.
- Même juridiction, personne qui demeure à l'étranger : + 2 mois.
- Juridiction dont le siège est dans une collectivité visée à l'art. 644, personne qui n'y demeure pas : + 1 mois ; personne qui demeure à l'étranger : + 2 mois.

Le moteur reçoit seulement `moisDistance` (0, 1 ou 2). Il ne choisit pas lui-même le régime : l'utilisateur indique l'augmentation. La liste exacte des collectivités et le champ des délais concernés (comparution, appel, opposition, tierce opposition de l'art. 586 al. 3, recours en révision, pourvoi) restent ceux des articles, **à valider par l'avocat** — le texte intégral de Légifrance n'a pas pu être relu directement le 2026-09-25.

Cas : 10 janvier 2024 + 1 mois + 2 mois de distance → 10 avril 2024. 10 janvier 2024 + 1 mois de distance, puis 15 jours → 25 février 2024, report du dimanche au 26 février 2024.

## Hors périmètre de ce jalon

Agenda complet (audiences, rendez-vous, tâches, invitations). L'écran « La journée » expose seulement le calcul ci-dessus.
