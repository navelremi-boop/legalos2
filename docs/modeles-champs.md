# Champs des modèles de documents

Catalogue des champs que la fusion peut remplir. Un champ absent des données, ou vide, arrête la génération et le nom du champ est indiqué. Aucune balise `{…}` ne reste dans le document produit.

Les délimiteurs sont `{` et `}`. Le préfixe `{@rawXml}` est réservé à une insertion future de blocs ; aucun module payant n'est installé.

| Champ | Source |
| --- | --- |
| `dossier_nom` | Nom du dossier |
| `dossier_reference` | Référence attribuée. Vide tant que la référence est en attente : la génération s'arrête alors et nomme ce champ. |
| `client_nom` | Partie dont le rôle est « client ». Inchangé. |
| `client_designation` | Désignation dans les actes du client. Vide si une mention manque : la génération s'arrête et nomme ce champ. |
| `client_adresse` | Adresse du domicile ou du siège du client. |
| `client_representant_designation` | Désignation de l'organe qui représente la société cliente. |
| `adversaire_designation` | Désignation dans les actes de la partie dont le rôle est « adversaire ». |
| `cabinet_nom` | Nom du cabinet. |

## Désignation dans les actes

`client_designation`, `client_representant_designation`, `adversaire_designation` et le champ `{designation}` des boucles d'intervenants reprennent la même désignation, calculée par `apps/poste/src/contacts/designation.ts` à partir de la fiche. Elle est une phrase complète et **se termine par un point** : un modèle ne le double pas. Les textes entre crochets sont les données de la fiche.

- **Société** : « La société [dénomination], [forme en toutes lettres] au capital de [capital] €, immatriculée au registre du commerce et des sociétés de [greffe] sous le numéro [SIREN par groupes de trois], dont le siège social est situé [adresse], prise en la personne de son [fonction] en exercice, [M. ou Mme] [prénom usuel] [nom], domicilié(e) en cette qualité audit siège. »
- **Personne** : « [M. ou Mme] [prénoms] [nom], né(e) [le …] [à …], de nationalité [nationalité], [profession], demeurant [adresse]. »
- **Professionnel** (avocat, commissaire de justice, notaire, expert, mandataire…) : « Me [prénom nom], avocat(e) au barreau de … », ou « [M. ou Mme] [prénom nom], expert(e)-comptable » pour les professions sans « Me », et équivalents. Point final comme les autres.
- **Société exerçant une profession réglementée** (par exemple une SARL d'expertise comptable) : formule des sociétés, comme toute société.

Règles de rédaction :

- « [M. ou Mme] » : Madame donne « Mme », Monsieur « M. », Maître « Me » ; une autre civilité s'écrit telle que saisie ; Mademoiselle est refusée. « né(e) » et « domicilié(e) » s'accordent avec la civilité (Madame, Monsieur) ou avec l'accord saisi sur la fiche (Maître et autres). « née » est suivi du nom de naissance quand il diffère du nom.
- « de nationalité [nationalité] » : le nom « nationalité » est féminin, l'adjectif est donc toujours écrit au féminin (« de nationalité française »), pour un homme comme pour une femme, quelle que soit la forme saisie (« français », « Française »).
- « [prénoms] » pour une personne, « [prénom usuel] » (le premier prénom) pour l'organe représentant une société. « [fonction] » est la fonction du mandat en cours marqué « représente la société », accordée avec la personne : « sa gérante », « sa directrice générale », mais « son membre du directoire » pour une fonction qui ne change pas au féminin.
- « [forme en toutes lettres] » : le libellé de la table des catégories juridiques de l'INSEE embarquée, sans précision entre parenthèses ni sigle en tête (« société par actions simplifiée », « société à responsabilité limitée »).
- « [greffe] » : sans « RCS de », avec l'élision ou l'article contracté (« de Lyon », « d'Aix-en-Provence », « du Mans »). « [capital] » : sans centimes quand le montant est rond (« 50 000 »), avec centimes seulement s'ils existent (« 10 000,50 »). SIREN : « 812 345 676 ».
- Une mention manquante est signalée sur la fiche, nommée (« la profession », « l'organe représentant »…) et arrête la fusion d'un modèle qui utilise le champ : le champ est alors vide et la génération nomme `client_designation` (ou le champ concerné). Une société dont aucun mandat en cours ne représente la société manque de « organe représentant ».

Boucle par qualité, une ligne par intervenant. `rattache_a` est vide s'il n'y a pas de rattachement, et ce vide n'arrête pas la génération. `{nom}`, `{designation}` et `{adresse}` vides l'arrêtent.

`{#intervenants_<code>}{nom}{designation}{adresse}{rattache_a}{/intervenants_<code>}`

Le nom de la boucle est `intervenants_<code>`.

Genres livrés : courrier, convention, acte. Chacun est remplaçable depuis Réglages, sans recompiler le binaire. Le fichier de remplacement est stocké pour le cabinet (stockage objet de l'instance). Le poste en garde une copie : la génération lit cette copie et n'appelle pas l'instance. Si le réseau est coupé au moment de verser le document produit, le fichier reste sur le poste et le versement reprend au retour.
