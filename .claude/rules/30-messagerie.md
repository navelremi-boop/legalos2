---
paths:
  - "crates/messagerie/**"
---

# Messagerie

Référence : cahier des charges § 3.8.

- Bibliothèque IMAP imposée : `io-imap` `=0.6.1`, sur `imap-codec` `=2.0.0-alpha.8`. `async-imap` n'est pas ajouté. Aucune mise à jour sans instruction de l'architecte ; une mise à jour autorisée repasse l'ensemble des tests mail. Aucun analyseur IMAP ou MIME maison. `mail-parser`, `ammonia`, `lettre`, `oauth2` pour le reste.
- Tout usage d'`io-imap` reste dans `crates/messagerie/src/imap.rs`. Aucun type `io-imap` ou `imap-codec` ne sort du crate. L'interface publique est `FournisseurMail`.
- Boîte de réception : `ImapMailboxWatch` sur une connexion dédiée (IDLE, QRESYNC, repli par comparaison). Changement d'UIDVALIDITY : resynchronisation complète du dossier. Les autres dossiers : relève incrémentale. Lu, drapeau, déplacement et suppression : autre connexion. La veille est en lecture seule.
- Synchronisation **uniquement côté serveur**, derrière `FournisseurMail`.
- **File d'envoi** : brouillon → en attente → envoyé → copie dans « Envoyés » confirmée → (échec). Un mail ne sort jamais de la file avant la confirmation. Identifiant de message généré une seule fois ; vérification dans « Envoyés » avant toute nouvelle tentative.
- Changement de validité des identifiants IMAP → resynchronisation complète du dossier concerné, sans perte des rattachements aux dossiers.
- HTML nettoyé avant stockage ; images distantes jamais chargées côté serveur.
- **Jamais** de contenu de mail, d'objet ou d'adresse dans les journaux.
- Tests contre GreenMail : coupure réseau pendant l'envoi, changement de validité, boîte de 50 000 messages.
