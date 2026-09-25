# Hypothèse — premier administrateur

Le cahier des charges ne décrit pas la création du premier compte. Hypothèse retenue le 2026-09-25, **à valider par l'avocat** :

- Les migrations ne créent aucun compte.
- `cargo xtask install` crée le premier administrateur du cabinet, une seule fois.
- Le mot de passe et le secret TOTP sont générés aléatoirement et affichés une fois sur la sortie standard. Ils ne sont pas écrits dans le dépôt.
- S'il existe déjà un utilisateur, la commande refuse.
