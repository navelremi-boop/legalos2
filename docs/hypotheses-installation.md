# Hypothèse — premier administrateur

Le cahier des charges ne décrit pas la création du premier compte. Hypothèse retenue le 2026-09-25, **à valider par l'avocat** :

- Les migrations ne créent aucun compte.
- `cargo xtask install` crée le `.env` de l'instance (clé de chiffrement aléatoire, `LEGALOS_MODE` absent donc production) et le premier administrateur, une seule fois.
- Le mot de passe, le secret TOTP et l'URI `otpauth` sont affichés une fois. Ils ne sont pas écrits dans le dépôt.
- S'il existe déjà un utilisateur, la commande refuse.
