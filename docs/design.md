# Design du poste — référence visuelle

Les maquettes validées par le commandement font foi pour la composition de chaque écran : éléments présents, disposition, hiérarchie, libellés, états. docs/design.md fait foi pour les mesures communes : grille, largeurs, espacements, échelle typographique, jetons, états génériques. Quand un écran validé introduit un motif que docs/design.md ne connaît pas, docs/design.md s'enrichit de ce motif ; il ne le remplace jamais par un composant existant. Tout écart restant entre une maquette validée et docs/design.md est listé dans JOURNAL.md et soumis au commandement.

Sources : jetons dans `design/tokens.css` (seul fichier autorisé à contenir des couleurs), composants communs à la fin de `apps/poste/src/index.css`, recette `tests/recette/coque-app.mjs --captures` (captures et contrôle de la grille).

## 1. Grille et largeurs maximales

Un écran se lit dans **une colonne centrée**. La barre du haut, seule, occupe toute la largeur de la fenêtre : c'est le cadre de l'application, pas son contenu.

| Jeton | Valeur | Usage |
|---|---|---|
| `--gouttiere` | `clamp(24px, 2.2vw, 48px)` | marge minimale de chaque côté |
| `--colonne-max` | 1 120 px | colonne courante : en-tête d'écran et feuille |
| `--colonne-large` | 1 440 px | écrans à trois volets : Mails, Agenda (classe `.ecran--large`) |
| `--intercalaires-largeur` | 136 px | intercalaires à droite de la feuille d'un dossier |
| `--lecture-max` | 68 caractères | corps de texte, messages, explications |
| `--formulaire-max` | 520 px | formulaire sur une colonne |
| `--panneau-largeur` | 440 px | panneau latéral |

Règles :

- La racine d'un écran porte `.ecran`. Ses marges valent `max(gouttière, (100 % − colonne) / 2)` : sur grand écran, l'en-tête et la feuille restent alignés sur les mêmes bords.
- La vue d'un dossier centre **la feuille et ses intercalaires ensemble** ; la barre d'actions se centre sur la feuille.
- Les éléments liés restent proches : le nom d'un dossier et son échéance se suivent (écart de 16 px), jamais aux deux bouts d'une ligne. Une valeur ne s'aligne à droite que dans une colonne de tableau (montant, durée, état).
- Une liste de plusieurs valeurs est une **grille à colonnes fixes** (Temps, Facturation), pas une ligne à `space-between`.
- Aucun débordement horizontal, de 1 366 à 2 560 px de large.

## 2. Espacements

Échelle en multiples de 4 px, jetons `--espace-1` à `--espace-8` :

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| 4 | 8 | 12 | 16 | 24 | 32 | 48 | 64 |

- Entre l'en-tête d'écran et la feuille : 24 px. Haut d'écran : 32 px.
- Intérieur de feuille : 22 à 24 px ; bas de feuille : 96 px, pour que la barre d'actions ne masque jamais la dernière ligne.
- Entre deux champs : 16 px. Entre l'étiquette et son champ : 4 px. Entre deux sections d'un panneau : 32 px, séparées d'un filet.
- Hauteur de ligne de liste : 44 px au moins (`--row-height-list`).

## 3. Typographie

Une seule police, Atkinson Hyperlegible Next, graisses 400, 700 et 800.

| Rôle | Taille | Graisse | Jeton |
|---|---|---|---|
| Titre d'écran | 28 px | 800 | `--font-size-journee` |
| Nom du dossier (étiquette) | 26 px | 800 | `--font-size-dossier` |
| Titre de section, de panneau | 17 px | 800 | `--font-size-section` |
| Texte d'un mail | 15 px | 400 | `--font-size-mail` |
| Texte courant | 14 px | 400 | `--font-size-base` |
| Listes denses, boutons, champs | 13 px | 400 ou 700 | `--font-size-dense` |
| Étiquettes, dates, compteurs | 12 px | 700 | `--font-size-meta` |

- Casse de phrase partout. Les libellés calculés en minuscules (« mercredi 28 octobre », « contentieux ») prennent une majuscule initiale à l'affichage (`::first-letter`), jamais dans la donnée.
- Un titre ne se coupe pas au milieu d'une colonne étroite : `white-space: nowrap` et points de suspension si la place manque vraiment.
- Pas de troncature quand la place existe : un nom tronqué signale une colonne trop étroite, on élargit la colonne.

## 4. Chiffres

- Chiffres alignés partout (`lining-nums`). **Proportionnels dans les phrases**, **tabulaires dans ce qui s'aligne en colonne** : montants, durées, heures de l'agenda, compteurs, mini-calendrier, chronomètre, tableaux (liste des sélecteurs à la fin de `index.css`, section « Améliorations »).
- **Zéro ordinaire** dans l'interface : montants (« 1 200,00 € »), heures (« 9 h 00 »), durées, dates, compteurs. La police d'origine ne dessine qu'un zéro barré ; l'interface utilise donc une variante produite par `design/fonts/zero-sans-barre.py` (famille « Atkinson Hyperlegible Next », fichier `AtkinsonHyperlegibleNext-Interface-Variable.ttf`).
- **Zéro barré réservé aux références** : référence de dossier (« 2026-042 »), numéro de facture, numéro RG. Ces textes portent `.chiffres-reference` (ou `.etiquette-dossier__ref`, `.onglet-dossier__ref`, `.mails-dos`) et la famille `--font-reference`, qui charge le fichier d'origine. Dans un libellé libre, `TexteReferences` repère les références et leur applique cette classe.
- Les montants s'alignent à droite dans leur colonne (`.montant`).

## 5. Couleurs

Toutes les couleurs sont des jetons de `design/tokens.css`, redéfinis pour la nuit. Aucun code couleur ailleurs (la recette `coque-app.mjs` échoue sinon).

| Jeton | Jour | Nuit | Usage |
|---|---|---|---|
| `--neutre` | `#d6cfc2` | `#1e2629` | fond hors dossier |
| `--feuille` | `#ffffff` | `#1a2023` | feuille, panneaux, menus |
| `--feuille-2` | `#f6f8f7` | `#20272a` | volets secondaires, pastilles |
| `--encre` | `#141a1c` | `#e8eeec` | texte |
| `--graphite` | `#5a6569` | `#9ca8ac` | texte secondaire, étiquettes |
| `--filet` | `#e8eceb` | `#2b3438` | séparateurs |
| `--survol` | `#f3f6f5` | `#222a2d` | survol d'une ligne |
| `--selection-fond` | `#e9eeec` | `#273034` | élément choisi, filtre actif |
| `--champ-fond` | `#ffffff` | `#151b1d` | fond des champs |
| `--champ-bord` | `#cdd5d3` | `#3a4549` | bord des champs et boutons |
| `--champ-bord-survol` | `#9aa6a9` | `#56646a` | bord au survol |
| `--bouton-prim-fond` | `#141a1c` | `#e8eeec` | bouton principal |
| `--echeance` | `#b42318` | `#f07a6a` | délai à 2 jours ouvrés ou moins, erreurs |
| `--definitif` | `#43388a` | `#bdb4f5` | badge à cadenas, pièce non modifiable |
| `--attente` | `#9a6a12` | `#e8b85c` | à faire : non facturé, alerte de convention, conflit |
| `--ok` | `#2f7d4b` | `#7bd89a` | vérification réussie |
| `--chemise-point` | fond de la chemise | accent de la chemise | point de chemise d'une pastille de référence sur teinte (jamais seul) |

Couleurs réservées, inchangées : rouge `echeance` pour l'urgence et l'erreur, violet `definitif` pour l'immuable, couleur de chemise jamais seule ni pour un statut. Dans l'agenda, un bloc prend la teinte de la chemise de son dossier avec un liseré d'accent ; le nom du dossier figure dans le détail.

## 6. États

| État | Règle |
|---|---|
| Survol | fond `--survol` (lignes) ou `--bouton-survol` et bord `--champ-bord-survol` (boutons, champs), transition 150 ms |
| Focus | contour 2 px `--focus` décalé de 2 px ; champs : bord `--focus` et anneau `--anneau-focus`. Toujours visible au clavier |
| Désactivé | opacité 0,5, curseur interdit ; le libellé reste lisible |
| Actif, choisi | `aria-pressed`, `aria-current` ou `aria-selected` : fond `--selection-fond` et graisse 700 ; onglet de contrôle segmenté : fond `--feuille` en relief |
| Chargement | `LignesFantomes` : lignes provisoires qui respirent doucement pendant la première lecture de la base locale (Dossiers, Temps, La journée) ; jamais un écran vide qui laisserait croire qu'il n'y a rien |
| Vide | `.etat-vide` : une phrase en `--graphite` qui dit quoi faire (« Choisissez un élément de l'agenda pour en voir le détail. ») |
| Confirmation | `Annonce` : pastille sombre en bas de la zone de travail (ou du panneau), qui s'efface après 4 s ; une erreur garde le style `.message-erreur` et reste jusqu'au message suivant. Le texte reste dans le document |
| Erreur | `.message-erreur` : fond `--echeance-fond`, texte `--echeance` ; champ invalide : `aria-invalid="true"`, bord `--erreur-bord` |
| Attention | `.message-attention` : fond `--feuille-2`, liseré `--attente` (conflit d'agenda, alerte de convention) |
| Information | `.message-info` : fond `--feuille-2` (conflit de synchronisation, hors ligne) |
| Aujourd'hui | mini-calendrier : pastille pleine `--aujourdhui` ; agenda : point et soulignement du titre du jour, colonne teintée |

## 7. Composants communs

Toutes les classes sont dans `apps/poste/src/index.css`, section « Harmonisation ».

- **En-tête d'écran** `.ecran-tete` : titre `.ecran-tete__titre`, sous-titre `.ecran-tete__sous-titre`, information à droite `.ecran-tete__aside`. Même hauteur et mêmes bords que la feuille.
- **Bouton** `.bouton` (34 px) ; `.bouton--prim` (une action principale par zone), `.bouton--discret` (sans cadre), `.bouton--petit` (28 px). Lien d'action : `.lien-action`, souligné. Jamais de flèche dans un bouton.
- **Champ** `.champ` (34 px, fond `--champ-fond`, bord `--champ-bord`) ; liste déroulante avec chevron dessiné par `--chevron` ; `.etiquette-champ` au-dessus de chaque champ, jamais un simple texte indicatif à la place de l'étiquette. Les champs sans classe reçoivent la même apparence.
- **Filtres** `.filtres` / `.filtre` (pastilles à bascule, compteur `.filtre__compte`) ; **contrôle segmenté** `.segment` pour deux à quatre vues exclusives (Jour, Semaine ; Le cabinet, Mes temps).
- **Panneau latéral** `PanneauLateral` (`apps/poste/src/coque/PanneauLateral.tsx`) : tout formulaire secondaire s'ouvre à droite, 440 px, au-dessus d'un voile léger ; titre, phrase d'explication, bouton « Fermer », touche Échap. Le contenu reste monté fermé : rien de ce qui est saisi ne se perd. Utilisé pour la convention d'honoraires, les parties et dossiers liés, le nouvel élément d'agenda et le calcul de délai. Il glisse de 32 px en 220 ms à l'ouverture, le voile apparaît en fondu (mouvement supprimé si « réduire les animations » est demandé).
- **Raccourcis** déclarés dans `apps/poste/src/coque/raccourcis.ts` (T : saisir du temps ; Ctrl K : rechercher). Chaque bouton qui en a un porte `aria-keyshortcuts` et une infobulle ; la touche s'affiche dans la barre d'actions, la recherche et le menu du compte.
- **Densité** : réglage « Confortable » ou « Compacte » dans Réglages, Apparence (`coque/densite.ts`, préférence locale du poste). La densité compacte réduit la hauteur des lignes (34 px) et des contrôles, et masque l'extrait des mails.
- **Choix d'un dossier** `ChoixDossier` (`apps/poste/src/dossiers/ChoixDossier.tsx`) : un dossier se choisit **par recherche** sur son nom ou sa référence, au clavier ou à la souris, jamais en tapant un identifiant. La valeur vit dans un contrôle masqué qui garde l'`id`, le `name` et le `data-testid` historiques.
- **Badge à cadenas** `.badge-definitif` : seulement ce qui ne peut plus changer (facture validée, déposée, encaissée, avoir). Brouillon : `.etat-brouillon`, neutre.
- **Liste de dossiers** `.dossiers-ligne` : bande de chemise, référence, nom suivi de l'échéance, compteur de non lus en pastille.
- **Fiche** `.fiche-infos` : étiquettes et valeurs sur deux colonnes ; procédure en `.fiche-procedure` (étapes faites, en cours, à venir).
- **Boutons sur la chemise** `.bouton-chemise` (verre, comme les intercalaires) et `.alerte-chemise` (pastille claire à point `--attente`) dans l'en-tête d'un dossier.

### Fiche de contact : motifs de la maquette Contacts

Motifs introduits par `design/maquettes/prototype-contacts.html` (écran validé) ; classes dans `apps/poste/src/index.css`, section « Contacts ». Mesures relevées dans le DOM de la galerie, identiques à celles de la maquette sauf mention contraire.

- **Corps de fiche** `.contacts-corps` : zone défilante sous les onglets, rembourrage 18 px en haut, 24 px sur les côtés, 96 px en bas (la barre d'actions flottante ne masque jamais la dernière ligne). Titre de section `.sec-t` : 12 px, 700, `--graphite`, marge 20 px au-dessus et 8 px au-dessous (0 au-dessus du premier).
- **Onglet Général en lecture** : les boutons du corps (Ajouter, Modifier, Copier, Compléter, Comparer et fusionner) portent `.contacts-act` comme ceux de la tête de fiche (fond `--feuille-2`, anneau `--filet`, rayon 10 px), à 28 px et 12 px dans un titre de section, une désignation ou un bandeau ; dans un titre de section ils prennent la couleur `--graphite` du titre. Les blocs se suivent par leurs seules marges (20 px au-dessus d'un titre de section, 8 px au-dessous ; 12 px sous un bandeau), sans écart de flex en plus. Valeurs d'état civil à la majuscule initiale à l'affichage (« Française », « Chef d'entreprise »), la valeur saisie restant intacte. Naissance : « Né le 3 février 1972 à Saint-Étienne (Loire) », le lieu s'affichant comme saisi (le département n'est pas une donnée distincte). Une profession réglementée s'accorde à la civilité (« Avocate »), le ressort s'écrit « Cour d'appel de Lyon » sous le libellé « Ressort ». Le bandeau « Mention manquante » nomme chaque champ avec son article (« la profession », « le capital et l'organe représentant »).
- **Tuiles de chiffres** `.contacts-chiffres` (onglet Factures) : grille de trois colonnes égales, écart de 8 px, 14 px sous la rangée. Chaque tuile : fond `--feuille-2`, rayon 11 px, rembourrage 8 px et 10 px, sans bord ni ombre ; libellé 11,5 px `--graphite`, valeur 14 px en 700, chiffres tabulaires. Facturé, encaissé, encours ; jamais de couleur de statut sur une tuile. Écart assumé avec la maquette : les montants s'écrivent avec leurs centimes (« 6 000,00 € »), règle commune du § 4.
- **Tableau de fiche** `.contacts-tab` : pleine largeur, 12,5 px. En-têtes 12 px, 400, `--graphite`, rembourrage 0 10 px 6 px 0, sans retour à la ligne. Cellules rembourrées de 8 px en haut et en bas et de 10 px à droite, filet haut de 1 px `--filet`, alignées en haut. Montants à droite en chiffres tabulaires. Référence de facture en 700 au zéro barré. Statut en 700 : `--ok` payée, `--attente` en attente, `--graphite` brouillon. Une colonne dont aucune ligne n'a de valeur (date, objet) disparaît.
- **Ligne de dossier avec pastille** `.contacts-dos` (onglet Dossiers) : liste en grille à deux colonnes (pastille de largeur de son contenu, texte), écart de 14 px, lignes en sous-grille pour que les noms s'alignent ; rembourrage de 9 px en haut et en bas, filet haut de 1 px `--filet` sauf la première. Pastille `.contacts-dos__ref` : 12 px en 700, rayon 9 px, rembourrage 4 px (10 px à droite, 8 px à gauche), fond `--chemise-teinte`, texte `--chemise-texte`, référence au zéro barré ; point de chemise rond de 9 px à 7 px du texte, de couleur `--chemise-point` (le fond de la chemise en jour, l'accent clair en nuit : seule valeur lisible sur la teinte sombre ; contraste mesuré de 6,1 à 6,9 en nuit). Nom du dossier 13 px en 700 `--encre`, qualité en 12 px `--graphite` dessous. La couleur de chemise n'est jamais seule : le nom du dossier est toujours sur la ligne.
- **Ligne de mail** `.contacts-mail` : deux colonnes (objet et expéditeur, date), écart de 12 px, rembourrage de 8 px en haut et en bas, filet haut de 1 px `--filet` sauf la première ; 12,5 px. Objet en 13 px, 700, sur sa ligne ; expéditeur et date en 12 px `--graphite`. Sous la liste, une mention `.contacts-mention` de 12 px `--graphite` avec une icône d'information de 14 px, 14 px plus bas. Écart assumé avec la maquette : elle rend l'expéditeur et la date à 10,4 px (élément `small` hérité de 12,5 px) ; l'échelle commune (étiquettes, dates : 12 px) l'emporte.
- **État vide composé** `.contacts-vide` : 14 px `--graphite`, rembourrage de 18 px en haut et en bas, 60 caractères au plus. Un titre en gras `--encre` sur sa propre ligne (3 px d'écart), puis une phrase qui dit quoi faire (« Aucune note », « Ce que le cabinet doit savoir de ce contact et qui n'a pas sa place ailleurs. »). Il complète `.etat-vide` (une phrase seule) pour les onglets d'une fiche ; il ne le remplace pas.
- **Bloc de notes** `.contacts-notes` : fond `--feuille-2`, rayon 12 px, rembourrage 12 px et 14 px, 13 px, interligne 1,55, 72 caractères au plus ; un paragraphe par note, 8 px d'écart, sans filet ni ombre.
- **Ligne de lien** `.contacts-lien` : deux colonnes (fonction et contact, période alignée à droite), écart de 14 px, rembourrage de 8 px, filet haut de 1 px sauf la première ; 13 px, fonction en 700, contact en lien souligné (`.contacts-lk`), pièce source en 12 px `--graphite` dessous ; un lien terminé passe en `--graphite`. Les groupes (Mandats sociaux, Dirigeants, Famille…) ont un titre `.sec-t`.

## 8. Écrans

- **Coque** : barre du haut pleine largeur ; contenu dans la colonne ; barre d'actions centrée sur la feuille, 24 px au-dessus du bas.
- **La journée** : quatre sections en deux colonnes, titre de section souligné d'un filet, lien d'action à droite ; « Classer » en bouton principal ; « Autre dossier » ouvre une recherche de dossier.
- **Dossiers** : recherche, filtres en pastilles, tri à droite ; groupes à titre court (« Cette semaine », « Sans échéance ») ; aperçu à droite en fiche.
- **Vue d'un dossier** : une rangée compacte avec l'étiquette, l'essentiel (juridiction, n° RG, client, adversaire) et la jauge réduite ; confrère, type, étape et dossiers liés se déplient par « Plus d'informations ». Dessous, les actions secondaires : état de la convention, « Convention d'honoraires », « Parties et dossiers liés ». Les formulaires correspondants s'ouvrent en panneau ; rien n'est ouvert en permanence sur la chemise.
- **Mails** : colonne large ; rail 240 px, liste au moins 360 px (32 %), lecture le reste ; l'objet tient sur deux lignes avant d'être coupé.
- **Agenda** : colonne large ; navigation, titre de période en toutes lettres sur sa ligne, vue Jour ou Semaine en contrôle segmenté ; grille avec un filet par heure, heures alignées sur les filets, « Sans heure » sur une ligne ; jour courant marqué, avec un trait à l'heure courante ; en vue Semaine, un bloc ne montre que son titre et son heure, le détail est dans l'infobulle et dans le volet ; conflit en `.message-attention`.
- **Temps** : une feuille ; chronomètre et saisie côte à côte (empilés sous 1 400 px), saisies en tableau (référence, libellé, durée, montant, état), volet du non facturé à droite.
- **Facturation** : tableau État, Pièce, Montant ; références au zéro barré.
- **Contacts, création** : « Nouveau contact » et « Importer par SIREN » ouvrent le formulaire dans la zone de la fiche (pas en panneau latéral) : étiquette « Nouveau contact » avec la nature et la phrase « La fiche rejoint l'annuaire commun du cabinet. », bascule personne morale / personne physique en contrôle segmenté, champs en grilles de deux ou trois colonnes (`.contacts-nc__g2`, `.contacts-nc__g3`), code postal et commune sur une ligne, « Enregistrer la fiche » (principal) et « Annuler » en pied. Échap annule.
- **Réglages** : navigation à gauche, contenu en formulaire de 520 px au plus, bouton « Enregistrer » principal. Pas de vocabulaire technique : le « nom court du cabinet ».
- **Connexion** : carte de 440 px au centre, vérifications en liste à points, progression en barres, bouton principal pleine largeur.

## 9. Contrôle

`node tests/recette/coque-app.mjs --captures` écrit, en plus des captures historiques, `design/captures/harmonisation/<écran>-<largeur>-<jour|nuit>.png` pour 1 366 × 768, 1 920 × 1 080 et 2 560 × 1 440, et échoue si un écran déborde horizontalement, si une feuille dépasse 1 440 px ou si une feuille hors dossier n'est pas centrée.
