ALTER TABLE dossiers ADD COLUMN visibilite TEXT NOT NULL DEFAULT 'public';
UPDATE dossiers SET visibilite = CASE WHEN restreint THEN 'restreint' ELSE 'public' END;

ALTER TABLE parties ADD COLUMN visibilite TEXT NOT NULL DEFAULT 'public';
UPDATE parties SET visibilite = CASE WHEN restreint THEN 'restreint' ELSE 'public' END;
