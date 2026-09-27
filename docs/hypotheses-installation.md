# Hypothèse — premier administrateur

Le cahier des charges ne décrit pas la création du premier compte. Hypothèse retenue le 2026-09-25, **retenue par l'architecte le 27/09/2026**. La revue par l'avocat avant toute mise en service réelle reste ouverte (B10).

- Les migrations ne créent aucun compte.
- `cargo xtask install` crée le `.env` de l'instance (`LEGALOS_MODE` absent donc production) et le premier administrateur, une seule fois. Tous les secrets du fichier, Garage compris, sont aléatoires : hors développement, l'instance refuse une valeur publiée dans `.env.example` ou `.env.development.example`. Si `.env` existe déjà et contient une de ces valeurs, la commande refuse. S'il existe sans valeur publiée, elle ne le réécrit pas et crée seulement l'administrateur.
- Le mot de passe, le secret TOTP et l'URI `otpauth` sont affichés une fois. Ils ne sont pas écrits dans le dépôt.
- S'il existe déjà un utilisateur, la commande refuse.
