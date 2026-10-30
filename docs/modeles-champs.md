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

Boucle par qualité, une ligne par intervenant. `rattache_a` est vide s'il n'y a pas de rattachement, et ce vide n'arrête pas la génération. `{nom}`, `{designation}` et `{adresse}` vides l'arrêtent.

`{#intervenants_<code>}{nom}{designation}{adresse}{rattache_a}{/intervenants_<code>}`

Le nom de la boucle est `intervenants_<code>`.

Genres livrés : courrier, convention, acte. Chacun est remplaçable depuis Réglages, sans recompiler le binaire. Le fichier de remplacement est stocké pour le cabinet (stockage objet de l'instance). Le poste en garde une copie : la génération lit cette copie et n'appelle pas l'instance. Si le réseau est coupé au moment de verser le document produit, le fichier reste sur le poste et le versement reprend au retour.
