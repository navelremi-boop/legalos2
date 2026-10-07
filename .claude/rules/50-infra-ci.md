---
paths:
  - "instance/**/Dockerfile"
  - "instance/**/*compose*.yml"
  - ".github/**"
  - "xtask/**"
---

# Infrastructure et CI

- **Images Docker** en version figée, jamais `latest`. Actions GitHub épinglées sur une version précise.
- **Volumes nommés** plutôt que montages de répertoires Windows.
- **Commandes du dépôt** dans `cargo xtask` (recette, demo, vérifications) : multiplateformes, sans bash.
- **CI** : Windows et Linux à chaque push ; macOS pour le build et le test de fumée (S14b). Jobs : lints, tests, recette, validation Factur-X, captures, contrôle des couleurs en dur, contrôle des marqueurs de tests désactivés, contrôle de l'absence de WebDriver dans le build distribué.
- **Secrets de CI** : uniquement ceux de test ; jamais de secret réel.
- **Aucun push de tag de version** : les releases restent une décision humaine.
- **État d'un run** : `gh run view <id> --json status,conclusion,jobs` (ou l'API GitHub) à chaque lecture, jamais de mémoire ni d'un résultat antérieur.
- **Attente** : `gh run watch <id> --exit-status`, jamais un arrêt du tour.
