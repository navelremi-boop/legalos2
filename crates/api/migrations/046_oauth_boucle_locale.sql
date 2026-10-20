-- OAuth des boîtes par redirection de bouclage locale (J11, critère v-OAuth, consigne du 20/10/2026).
--
--   * `oauth_etats.redirect_uri` : l'adresse de bouclage (127.0.0.1, port libre) que le poste écoute ; l'échange du
--     code doit présenter la même ;
--   * `oauth_etats.expire_le` : un `state` vit 10 minutes et ne sert qu'une fois ;
--   * `comptes_mail.oauth_generation` : numéro de la connexion OAuth, augmenté à chaque (re)connexion par
--     l'utilisateur, jamais par le renouvellement du jeton d'accès (le jeton de rafraîchissement peut changer à
--     chaque renouvellement, la tâche de relève ne doit pas redémarrer pour autant) ;
--   * `comptes_mail.smtp_chiffrement` : `aucun`, `starttls` ou `implicite` ; vide, le chiffrement se déduit du port.

ALTER TABLE oauth_etats ADD COLUMN redirect_uri TEXT NOT NULL DEFAULT '';
ALTER TABLE oauth_etats ADD COLUMN expire_le TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes';
-- Serveurs IMAP et SMTP du fournisseur « simulateur » (développement seulement) ; vide pour Microsoft 365 et Gmail.
ALTER TABLE oauth_etats ADD COLUMN hotes JSONB;

ALTER TABLE comptes_mail ADD COLUMN oauth_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comptes_mail ADD COLUMN smtp_chiffrement TEXT;
ALTER TABLE comptes_mail ADD CONSTRAINT comptes_mail_smtp_chiffrement_check
    CHECK (smtp_chiffrement IS NULL OR smtp_chiffrement IN ('aucun', 'starttls', 'implicite'));
