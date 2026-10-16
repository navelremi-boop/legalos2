-- J11 (i) : identité d'envoi. Un mail part de l'adresse du compte choisi à la rédaction
-- (boîte nominative ou partagée), avec le SMTP de ce compte et, si le compte en définit un, un
-- `Reply-To`. Uniquement additif ; toutes les colonnes sont facultatives.
--
--   * `smtp_hote`, `smtp_port` : serveur SMTP du compte. Si `smtp_hote` est vide, l'envoi se
--     replie sur le SMTP du cabinet (variables MESSAGERIE_SMTP_*) : l'enveloppe et le `From`
--     restent ceux du compte, seul le relais change. Ce repli ne vaut que pour un compte qui ne
--     définit pas de SMTP ; il est consigné dans le journal technique (identifiant de compte).
--   * `smtp_utilisateur`, `smtp_secret_chiffre` : authentification SMTP, chiffrée comme le
--     secret IMAP (`secret_chiffre`) et jamais renvoyée au poste. Sans utilisateur, aucune
--     authentification n'est présentée ; avec un utilisateur et sans secret propre, le secret
--     IMAP du compte est repris.
--   * `repondre_a` : adresse `Reply-To`. Vide, aucun en-tête `Reply-To` n'est écrit.
--
-- Le chiffrement du transport SMTP (STARTTLS, TLS implicite) n'est pas encore pris en charge :
-- il demande une dépendance TLS de `lettre` (voir docs/versions.md). Aucune colonne n'est
-- ajoutée tant que le comportement n'existe pas.
ALTER TABLE comptes_mail ADD COLUMN smtp_hote TEXT;
ALTER TABLE comptes_mail ADD COLUMN smtp_port INTEGER
    CHECK (smtp_port IS NULL OR smtp_port BETWEEN 1 AND 65535);
ALTER TABLE comptes_mail ADD COLUMN smtp_utilisateur TEXT;
ALTER TABLE comptes_mail ADD COLUMN smtp_secret_chiffre TEXT;
ALTER TABLE comptes_mail ADD COLUMN repondre_a TEXT;
