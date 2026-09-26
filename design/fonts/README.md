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
