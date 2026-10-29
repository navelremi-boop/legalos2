# Polices embarquées (LEGAL OS)

## Atkinson Hyperlegible Next (OFL)

Source officielle : [Atkinson Hyperlegible Next](https://brailleinstitute.org/freefont) (Braille Institute).

Fichiers attendus dans l’app (chemins servis par Vite / Tauri, **sans Google Fonts**) :

| Graisse | Fichier woff2 |
|--------|----------------|
| 400 | `apps/poste/public/fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Regular.woff2` |
| 700 | `apps/poste/public/fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Bold.woff2` |
| 800 | ExtraBold non fourni pour l’instant : `@font-face` 800 pointe vers Bold (`tokens.css`) |

Les `@font-face` sont déclarés dans `design/tokens.css` (source unique des jetons).

**Grain :** tuile fixe `design/grain.svg`, référencée par `--grain` dans `tokens.css` (jamais recalculée en JS).

Tant que les woff2 sont absents, le navigateur retombe sur `system-ui` (développement uniquement).

## Variante d'interface : zéro sans barre

La police ne dessine qu'un zéro barré et n'offre aucune fonction OpenType pour le retirer. L'interface utilise donc `AtkinsonHyperlegibleNext-Interface-Variable.ttf`, où le contre-poinçon du zéro (fendu en deux par la barre) est remplacé par un seul contour, recalculé pour chaque graisse.

- Régénérer : `python design/fonts/zero-sans-barre.py` (fontTools requis).
- `tokens.css` déclare cette variante sous la famille « Atkinson Hyperlegible Next », et le fichier d'origine sous « Atkinson Hyperlegible Next Reference » (jeton `--font-reference`), réservé aux références : dossier, facture, RG (`docs/design.md`, Chiffres).
