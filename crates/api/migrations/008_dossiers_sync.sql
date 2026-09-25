ALTER TABLE dossier_acces ADD COLUMN utilisateur_texte TEXT;
ALTER TABLE dossier_acces ADD COLUMN dossier_texte TEXT;

UPDATE dossier_acces
SET utilisateur_texte = utilisateur_id::text,
    dossier_texte = dossier_id::text;

ALTER TABLE dossier_acces ALTER COLUMN utilisateur_texte SET NOT NULL;
ALTER TABLE dossier_acces ALTER COLUMN dossier_texte SET NOT NULL;

ALTER TABLE parties ADD COLUMN restreint BOOLEAN NOT NULL DEFAULT FALSE;
