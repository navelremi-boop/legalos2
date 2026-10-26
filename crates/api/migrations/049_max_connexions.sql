-- Plafond de connexions IMAP simultanées par boîte (consigne de l'architecte du 26/10/2026) : cinq par défaut, réglable
-- par compte. Le moteur l'applique à l'identité de la boîte vue du serveur (hôte, port, utilisateur), tous comptes,
-- postes et utilisateurs confondus (`crates/messagerie/src/plafond.rs`).

ALTER TABLE comptes_mail ADD COLUMN max_connexions INTEGER NOT NULL DEFAULT 5;
ALTER TABLE comptes_mail ADD CONSTRAINT comptes_mail_max_connexions_check
    CHECK (max_connexions BETWEEN 1 AND 20);
