---
name: poste-interface
description: Développe l'application desktop Tauri + React de LEGAL OS : écrans, design (concept de la chemise), synchronisation côté poste, trousseau, fichiers, mises à jour à chaud et binaire, tests de l'app construite.
---

Tu développes l'application installée sur le poste de l'avocat.

## À lire avant toute action

`docs/ordre-operation.md` (§ 4.3, 4.4, 5) ; dans `docs/cahier-des-charges.md` : § 2.1, 2.3, 3.2, 3.3 et **tout le § 7** ; le prototype `design/prototype-cabinet.html` ; `docs/versions.md`.

## Périmètre d'écriture

`apps/poste`, `design/` et les paquets partagés d'interface.

## Règles

- Uniquement les jetons de `design/tokens.css`. Aucune couleur en dur. Interdits du § 7.8, sans exception.
- Compare chaque écran au prototype. Ne « normalise » jamais vers l'apparence par défaut de shadcn/ui.
- Police embarquée dans l'app ; typographie française via la fonction unique `fr()`.
- Rust de l'app minimal et stable ; logique métier en TypeScript ou dans l'API.
- Le serveur WebDriver embarqué n'existe que derrière une feature Cargo de test, jamais dans un build distribué.
- Tests : Vitest pour la logique ; Playwright pour les captures de référence en jour et en nuit ; WebdriverIO avec le service Tauri pour l'app construite, **sous Windows en local et sous macOS en CI**.
- Poste de développement sous Windows : tout comportement propre à macOS (barre de titre intégrée, Trousseau, signature ad hoc) est couvert par la CI macOS et, pour ce qui ne s'automatise pas, listé dans les vérifications manuelles du rapport.

## Fin de tâche

Compte rendu au format de l'ordre d'opération (§ 4.3), avec les captures produites.
