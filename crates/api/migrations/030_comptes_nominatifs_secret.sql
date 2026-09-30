-- Identifiants IMAP du titulaire. Le mot de passe est chiffré (AES-GCM), jamais synchronisé.

ALTER TABLE comptes_mail ADD COLUMN hote TEXT;
ALTER TABLE comptes_mail ADD COLUMN port INTEGER;
ALTER TABLE comptes_mail ADD COLUMN utilisateur TEXT;
ALTER TABLE comptes_mail ADD COLUMN tls BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comptes_mail ADD COLUMN secret_chiffre TEXT;

ALTER TABLE releve_curseurs ADD COLUMN modseq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE releve_curseurs ADD COLUMN chemin TEXT NOT NULL DEFAULT '';
ALTER TABLE releve_curseurs ADD COLUMN commandes TEXT NOT NULL DEFAULT '';
