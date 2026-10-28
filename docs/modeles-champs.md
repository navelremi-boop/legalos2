# Champs des modèles de documents

Catalogue des champs que la fusion peut remplir. Un champ absent des données, ou vide, arrête la génération et le nom du champ est indiqué. Aucune balise `{…}` ne reste dans le document produit.

Les délimiteurs sont `{` et `}`. Le préfixe `{@rawXml}` est réservé à une insertion future de blocs ; aucun module payant n'est installé.

| Champ | Source |
| --- | --- |
| `dossier_nom` | Nom du dossier |
| `dossier_reference` | Référence attribuée. Vide tant que la référence est en attente : la génération s'arrête alors et nomme ce champ. |
| `client_nom` | Partie dont le rôle est « client ». |
| `cabinet_nom` | Nom du cabinet. |

Genres livrés : courrier, convention, acte. Chacun est remplaçable depuis Réglages, sans recompiler le binaire. Le fichier de remplacement est stocké pour le cabinet (stockage objet de l'instance). Le poste en garde une copie : la génération lit cette copie et n'appelle pas l'instance. Si le réseau est coupé au moment de verser le document produit, le fichier reste sur le poste et le versement reprend au retour.
