# Hypothèses — délais de procédure

*Version révisée par l'architecte le 26 septembre 2026, après vérification sur la base documentaire juridique (Memento Procédure civile 2024-2025, chapitres 10 « Délais, notification et signification » et 12 « Appel et opposition » ; cours de procédure civile). Sous réserve des modifications de textes postérieures à ces sources.*

Validation provisoire de l'architecte le 27/09/2026 : H1 à H13 sont retenues. La revue par l'avocat avant toute mise en service réelle reste ouverte (B10, dette « Avant J17 ») : chaque règle reste **à valider par l'avocat** à cette revue. Une règle marquée « vérifiée » concorde avec la base documentaire. Le jeu de cas automatique est `tests/recette/s8-delais.mjs`.

---

## H1 — Point de départ (art. 640) — concordante

*Texte non retrouvé dans la base documentaire ; formulation conforme au texte cité par l'agent.*

Le délai a pour origine la date de l'acte, de l'événement, de la décision ou de la notification qui le fait courir. Voir H11 pour la date de notification lorsqu'elle diffère selon la partie.

## H2 — Délai en jours (art. 641, al. 1) — vérifiée

Le jour de l'acte, de l'événement, de la décision ou de la notification ne compte pas. Un délai de N jours expire le N-ième jour qui suit l'origine.

Cas : origine 10 janvier 2024, 15 jours → 25 janvier 2024.

## H3 — Délai en mois ou en années (art. 641, al. 2 et 3) — vérifiée

Le délai expire le jour du dernier mois ou de la dernière année qui porte le même quantième que le jour de l'origine. À défaut de quantième identique, il expire le dernier jour du mois.

Cas : 31 janvier 2024 + 1 mois → 29 février 2024 ; 31 janvier 2023 + 1 mois → 28 février 2023 ; 15 mars 2024 + 1 mois → 15 avril 2024.

Le moteur doit aussi accepter les délais en années, avec la même règle de quantième.

## H4 — Mois puis jours (art. 641, al. 4) — vérifiée

Lorsqu'un délai est exprimé en mois et en jours, les mois sont décomptés d'abord, puis les jours.

Cas : 15 janvier 2024 + 1 mois et 10 jours → dimanche 25 février 2024 → report (H6) au lundi 26 février 2024.

## H5 — Expiration à vingt-quatre heures (art. 642, al. 1) — vérifiée

Tout délai expire le dernier jour à vingt-quatre heures. Le moteur ne manipule que des dates.

## H6 — Report au premier jour ouvrable (art. 642, al. 2) — vérifiée

Le délai qui expirerait normalement un samedi, un dimanche ou un jour férié ou chômé est prorogé jusqu'au premier jour ouvrable suivant. Les jours non ouvrables consécutifs s'enchaînent. Un jour férié situé **en cours** de délai est sans incidence : seul le dernier jour compte.

Cas :
- origine 15 mars 2024, 1 jour → samedi 16 mars → lundi 18 mars 2024 ;
- origine 30 mars 2024, 1 jour → dimanche 31 mars, puis lundi de Pâques 1er avril → mardi 2 avril 2024 ;
- origine 30 avril 2024, 1 jour → mercredi 1er mai → jeudi 2 mai 2024 ;
- **cas jurisprudentiel à ajouter au jeu de recette** : origine 20 février 2018, 3 mois → dimanche 20 mai 2018, puis lundi de Pentecôte 21 mai → **mardi 22 mai 2018** (Cass. 3e civ. 21 janvier 2021, n° 19-24.799).

## H7 — Jours fériés et chômés — vérifiée pour les fériés

Jours fériés (C. trav., art. L. 3133-1) : 1er janvier, lundi de Pâques, 1er mai, 8 mai, Ascension, lundi de Pentecôte, 14 juillet, 15 août, 1er novembre, 11 novembre, 25 décembre. Pâques par l'algorithme grégorien ; Ascension = Pâques + 39 jours ; lundi de Pentecôte = Pâques + 50 jours.

Jours chômés : légalement, seul le 1er mai est à la fois férié et chômé pour tous. Les autres jours chômés résultent d'usages ou de conventions et ne peuvent pas être déduits par le moteur.

**Retenu par l'architecte (27/09/2026)** : pas de jours chômés locaux en V1 (ni jours fériés d'Alsace-Moselle). L'écran rappelle que le calcul ne tient pas compte des jours chômés locaux.

## H8 — Augmentation pour la distance (art. 643, 644 et 645) — révisée

**Règle générale.**
- Juridiction dont le siège est en France métropolitaine (art. 643) : + 1 mois pour la personne qui demeure en Guadeloupe, en Guyane, à la Martinique, à La Réunion, à Mayotte, à Saint-Barthélemy, à Saint-Martin, à Saint-Pierre-et-Miquelon, en Polynésie française, dans les îles Wallis-et-Futuna, en Nouvelle-Calédonie ou dans les Terres australes et antarctiques françaises ; + 2 mois pour la personne qui demeure à l'étranger.
- Juridiction dont le siège est dans l'une des collectivités de l'art. 644 : + 1 mois pour la personne qui ne demeure pas dans la collectivité du siège ; + 2 mois pour celle qui demeure à l'étranger. Le critère est le **département du siège** de la juridiction : une partie qui demeure dans le ressort de la cour mais hors de ce département bénéficie de l'augmentation (Cass. 2e civ. 11 avril 2019, n° 18-11.268).

**Délais concernés.** Délais de comparution, d'appel, d'opposition, de tierce opposition dans le cas de l'art. 586, al. 3, de recours en révision et de pourvoi en cassation. Les augmentations s'appliquent **dans tous les cas où il n'y est pas expressément dérogé**, et elles sont automatiques (art. 645).

**Calcul.** L'augmentation s'ajoute aux mois du délai, avant le décompte des jours (H4) et avant le report (H6).

Cas : 10 janvier 2024 + 1 mois + 2 mois de distance → 10 avril 2024.

**Conséquence pour l'app.** L'utilisateur ne saisit plus un nombre de mois de distance. Il indique :
1. la juridiction (siège en métropole, ou dans l'une des collectivités de l'art. 644, avec son département) ;
2. la partie pour laquelle le délai est calculé et le lieu où elle demeure (voir H9) ;
3. le type de délai, choisi dans la bibliothèque, où chaque délai porte l'indication « augmentation pour distance : oui / non / régime spécial ».

Le moteur en déduit l'augmentation et l'affiche, avec sa source, à côté du résultat.

## H9 — Bénéficiaire et lieu retenu — nouvelle

- L'augmentation **n'est pas réciproque** : elle ne bénéficie qu'à la partie qui demeure loin du juge saisi (Cass. 2e civ. 23 juin 2016, n° 15-14.325 ; Cass. 2e civ. 7 septembre 2017, n° 16-15.700). Un délai se calcule donc toujours **pour une partie donnée**.
- Le lieu retenu est celui où la partie demeure **à la date de la notification** ; un déplacement ultérieur est sans effet (Cass. soc. 26 janvier 1977, n° 76-40.109 ; Cass. 1re civ. 25 mai 1987, n° 84-14.996).
- Une société dont le siège social est à l'étranger demeure à l'étranger, même représentée en France par un mandataire.

## H10 — Procédure d'appel avec représentation obligatoire (art. 915-4) — nouvelle

Les délais pour signifier la déclaration d'appel (art. 902 et 906-1), pour remettre les conclusions au greffe (art. 906-2 et 908 à 910) et pour les notifier ou les signifier (art. 911) sont augmentés :
- de 2 mois pour la partie qui demeure à l'étranger ;
- de 1 mois, devant une juridiction dont le siège est en France métropolitaine, pour la partie qui demeure dans l'une des collectivités d'outre-mer énumérées à H8 ;
- de 1 mois, devant une juridiction dont le siège est dans l'une des collectivités de l'art. 644, pour la partie qui n'y demeure pas.

Ces augmentations **s'ajoutent** à celles des art. 643 et 644 sur le délai d'appel lui-même.

Cas de recette (Memento, exemple a) : appelant demeurant à l'étranger, jugement de droit commun signifié le 10 janvier 2025 → délai d'appel 1 mois (art. 538) + 2 mois (art. 643) ; premières conclusions : 3 mois (art. 908) + 2 mois (art. 915-4) ; soit **8 mois au total à compter de la signification** si l'appel est formé le dernier jour. Le moteur doit enchaîner les deux calculs (échéance d'appel, puis échéance des conclusions à compter de la déclaration d'appel réellement formée).

**Retenu par l'architecte (27/09/2026)** : l'augmentation pour distance s'applique à la partie concernée, appelante ou intimée.

## H11 — Date de notification selon la partie (art. 647-1) — nouvelle

Pour une notification à l'étranger, en Polynésie française, dans les îles Wallis-et-Futuna, en Nouvelle-Calédonie ou dans les Terres australes et antarctiques françaises, la date de notification est, **à l'égard de celui qui y procède**, la date d'expédition de l'acte (ou, à défaut, la date de réception par le parquet compétent). Pour le destinataire, c'est la date de remise effective (système de la double date).

**Conséquence pour l'app.** L'écran demande, pour une notification dans ces territoires, les deux dates, et utilise celle qui correspond à la partie pour laquelle le délai est calculé.

## H12 — Renvoi après cassation — nouvelle

L'instance d'appel initiale se poursuit devant la juridiction de renvoi. Les augmentations pour distance **ne s'appliquent pas** au délai de saisine de la juridiction de renvoi (Cass. 2e civ. 4 février 2021, n° 19-23.638). Les délais pour conclure devant la juridiction de renvoi sont, eux, augmentés (art. 1037-1). **Retenu par l'architecte (27/09/2026)** : l'art. 1037-1 se lit avec l'art. 915-4 (l'ancien art. 911-2).

## H13 — Délais hors périmètre du moteur

Le moteur ne calcule pas : les délais exprimés en heures ; les délais « à rebours » (au plus tard N jours avant une date) ; les délais propres à des matières spéciales (expropriation, procédures collectives, prud'hommes, etc.). Ils seront ajoutés délai par délai à la bibliothèque, chacun avec sa source et son cas de test.

---

## Cas de recette à ajouter

| Cas | Attendu | Source |
|---|---|---|
| 20 février 2018 + 3 mois | mardi 22 mai 2018 (dimanche puis lundi de Pentecôte) | Cass. 3e civ. 21 janvier 2021, n° 19-24.799 |
| Appelant à l'étranger, signification 10 janvier 2025 | échéance d'appel 10 avril 2025 ; conclusions : 5 mois à compter de la déclaration d'appel | art. 538, 643, 908, 915-4 |
| Partie demeurant à Mayotte, juridiction en métropole | appel : 1 + 1 mois ; conclusions : 3 + 1 mois | art. 538, 643, 908, 915-4 |
| Partie demeurant à Saint-Barthélemy, cour de Basse-Terre | augmentation d'1 mois (hors département du siège) | Cass. 2e civ. 11 avril 2019, n° 18-11.268 |
| Intimé en métropole, appelant à l'étranger | aucune augmentation pour l'intimé | Cass. 2e civ. 23 juin 2016, n° 15-14.325 |
