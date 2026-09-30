-- Texte recherchable copié sur messages pour la synchro (pas de jointure, pas de seau par dossier).
-- Le titulaire est déduit du compte mail. L'API ne fournit ni l'un ni l'autre.

ALTER TABLE messages ADD COLUMN texte_brut TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN titulaire_id UUID REFERENCES utilisateurs (id);

UPDATE messages AS m
SET titulaire_id = c.titulaire_id
FROM comptes_mail AS c
WHERE c.id = m.compte_id;

UPDATE messages AS m
SET texte_brut = c.texte_brut
FROM contenus_messages AS c
WHERE c.message_id_ref = m.id
  AND c.texte_brut <> '';

CREATE INDEX messages_titulaire_idx ON messages (titulaire_id)
    WHERE titulaire_id IS NOT NULL;

CREATE FUNCTION completer_titulaire_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    SELECT titulaire_id INTO NEW.titulaire_id
    FROM comptes_mail
    WHERE id = NEW.compte_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER messages_complete_titulaire
    BEFORE INSERT OR UPDATE OF compte_id ON messages
    FOR EACH ROW
    EXECUTE FUNCTION completer_titulaire_message();

CREATE FUNCTION copier_texte_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE messages
    SET texte_brut = NEW.texte_brut,
        revision = revision + 1
    WHERE id = NEW.message_id_ref
      AND texte_brut IS DISTINCT FROM NEW.texte_brut;
    RETURN NEW;
END;
$$;

CREATE TRIGGER contenus_copie_texte
    AFTER INSERT OR UPDATE OF texte_brut ON contenus_messages
    FOR EACH ROW
    EXECUTE FUNCTION copier_texte_message();
