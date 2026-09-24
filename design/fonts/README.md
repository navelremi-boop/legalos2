# Polices embarquées (LEGAL OS)

## Atkinson Hyperlegible Next (OFL)

Source officielle : [Atkinson Hyperlegible Next](https://brailleinstitute.org/freefont) (Braille Institute).

Fichiers attendus dans l’app (chemins servis par Vite / Tauri, **sans Google Fonts**) :

| Graisse | Fichier woff2 |
|--------|----------------|
| 400 | `apps/poste/public/fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Regular.woff2` |
| 700 | `apps/poste/public/fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Bold.woff2` |

Les `@font-face` sont déclarés dans `design/tokens.css` (source unique des jetons).

**Phase 0 :** placer ici ou copier vers `public/fonts/…` les fichiers woff2 téléchargés depuis la distribution OFL. Tant qu’ils sont absents, le navigateur retombe sur `system-ui` (développement uniquement).
