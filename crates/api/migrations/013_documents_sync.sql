ALTER TABLE documents ADD COLUMN visibilite TEXT NOT NULL DEFAULT 'public';
ALTER TABLE documents ADD COLUMN dossier_texte TEXT;

UPDATE documents AS doc
SET dossier_texte = dos.id::text,
    visibilite = dos.visibilite
FROM dossiers AS dos
WHERE dos.id = doc.dossier_id;

UPDATE documents SET dossier_texte = dossier_id::text WHERE dossier_texte IS NULL;

ALTER TABLE documents ALTER COLUMN dossier_texte SET NOT NULL;

ALTER TABLE document_versions ADD COLUMN cabinet_id UUID;
ALTER TABLE document_versions ADD COLUMN dossier_id UUID;
ALTER TABLE document_versions ADD COLUMN visibilite TEXT;
ALTER TABLE document_versions ADD COLUMN dossier_texte TEXT;

UPDATE document_versions AS version
SET cabinet_id = doc.cabinet_id,
    dossier_id = doc.dossier_id,
    visibilite = doc.visibilite,
    dossier_texte = doc.dossier_texte
FROM documents AS doc
WHERE doc.id = version.document_id;

ALTER TABLE document_versions ALTER COLUMN cabinet_id SET NOT NULL;
ALTER TABLE document_versions ALTER COLUMN dossier_id SET NOT NULL;
ALTER TABLE document_versions ALTER COLUMN visibilite SET NOT NULL;
ALTER TABLE document_versions ALTER COLUMN dossier_texte SET NOT NULL;

CREATE FUNCTION propager_visibilite_documents() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite THEN
        UPDATE documents
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE document_versions
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER dossiers_visibilite_documents
    AFTER UPDATE OF visibilite ON dossiers
    FOR EACH ROW
    EXECUTE FUNCTION propager_visibilite_documents();
