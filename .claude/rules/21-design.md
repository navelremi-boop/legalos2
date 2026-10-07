---
paths:
  - "apps/poste/src/**/*.tsx"
  - "apps/poste/src/**/*.css"
  - "design/**"
---

# Design

Référence : cahier des charges § 7 et `design/prototype-cabinet.html`. En cas de doute, comparer au prototype, jamais à l'apparence par défaut d'une bibliothèque.

- **Jetons uniquement** (`design/tokens.css`). Aucune couleur en dur : la CI échoue sur tout code couleur hors du fichier de jetons.
- **Chemise ouverte** : l'espace de travail prend la couleur du dossier (valeur *fond*). Étiquette avec la référence (« Dossier 2026-042 ») et le nom (26 px) ; informations du dossier en texte simple ; jauge d'échéance ; feuille avec une carte derrière ; intercalaires à droite ; barre d'actions flottante. Hors dossier : fond `neutre`.
- **Matière et lumière** : grain fin en tuile fixe embarquée ; deux halos très doux sur la chemise. Jamais de dégradé multicolore ni de halo coloré.
- **Transparence floutée** : barre du haut, barre d'actions, jauge, intercalaires inactifs. Nulle part ailleurs.
- **Élévation** : étiquette, jauge, feuille, intercalaire actif, barre d'actions, menus. Jamais sur les lignes de liste.
- **Couleurs réservées** :
  - `echeance` (rouge) : délais à 2 jours ouvrés ou moins, et erreurs ;
  - `definitif` (violet) : badges à cadenas, uniquement sur ce qui ne peut plus être modifié ;
  - couleur de chemise : jamais pour un statut, jamais sans le nom du dossier.
- **Intercalaires** : les standards ne se retirent pas ; un élément rangé dans un intercalaire reste dans le chrono ; retirer un intercalaire ne supprime jamais son contenu.
- **Typographie** : Atkinson Hyperlegible Next embarquée, graisses 400, 700 et 800, chiffres tabulaires, échelle du § 7.3 ; tout texte affiché passe par `fr()`.
- **Mouvement** : 150 ms au survol, 300 ms au changement de dossier ; seul mouvement orchestré : le classement d'un mail ; « réduire les animations » respecté.
- **Interdits** : autre police ; dégradés multicolores ; flou sur de grandes surfaces ou derrière un texte long ; cadre ou pastille autour de chaque information ; libellés en capitales ; points médians comme séparateurs ; flèches dans les boutons ; icône seule sans libellé ni nom accessible ; traits à la main, tampons, textures de papier ; illustrations, émojis, animations d'entrée.
