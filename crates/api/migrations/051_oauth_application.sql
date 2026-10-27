-- Identifiants d'application OAuth de l'instance (D8, écran Réglages, administrateur). Une ligne
-- par fournisseur ; le secret est chiffré. Les variables d'environnement restent le repli tant
-- qu'aucune ligne n'est écrite.

CREATE TABLE oauth_application (
    fournisseur TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_secret_chiffre TEXT,
    tenant TEXT,
    CONSTRAINT oauth_application_fournisseur_check
        CHECK (fournisseur IN ('microsoft', 'gmail'))
);
