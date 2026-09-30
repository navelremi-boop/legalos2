-- Texte des drapeaux IMAP. PowerSync valide les flux comme du SQLite :
-- pas de fonction de tableau dans le SELECT synchronisé.

ALTER TABLE messages ADD COLUMN drapeaux_texte TEXT NOT NULL DEFAULT '';

CREATE FUNCTION copier_drapeaux_texte() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.drapeaux_texte := COALESCE(array_to_string(NEW.drapeaux, ' '), '');
    RETURN NEW;
END;
$$;

CREATE TRIGGER messages_copier_drapeaux_texte
    BEFORE INSERT OR UPDATE OF drapeaux ON messages
    FOR EACH ROW
    EXECUTE FUNCTION copier_drapeaux_texte();

UPDATE messages
SET drapeaux_texte = COALESCE(array_to_string(drapeaux, ' '), '')
WHERE drapeaux_texte = '';
