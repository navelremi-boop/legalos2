---
paths:
  - "apps/poste/src-tauri/**"
---

# Tauri

- **Tauri v2** uniquement ; vérifier chaque API dans la documentation v2.
- **Rust minimal** : trousseau, fichiers, notifications, mises à jour, pont PowerSync. La logique métier n'est pas ici.
- **Capacités au plus juste** : chaque permission accordée est justifiée ; aucune fenêtre n'accède à une URL distante avec l'IPC.
- **CSP stricte** ; aucune ressource chargée depuis Internet (police embarquée).
- **Secrets locaux** : uniquement le jeton de rafraîchissement, dans le trousseau du système. Échec d'accès → retour à la connexion, sans plantage.
- **WebDriver embarqué** : derrière une feature Cargo de test, absent des builds distribués ; un test de la CI le vérifie.
- **Mises à jour** : binaire par le module officiel ; interface par le plugin de mise à jour à chaud copié dans le dépôt ; signatures vérifiées dans les deux cas.
- **Multiplateforme** : répertoires de données via l'API de Tauri ; comportement vérifié sous Windows en local et sous macOS en CI.
