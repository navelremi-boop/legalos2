-- Arborescence documents (repertoires) + revision, texte extrait, parent de version.
-- Ajouts seulement.

CREATE TABLE repertoires (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    parent_id UUID REFERENCES repertoires (id) ON DELETE RESTRICT,
    nom TEXT NOT NULL,
    visibilite TEXT NOT NULL,
    dossier_texte TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT repertoires_visibilite_check
        CHECK (visibilite IN ('public', 'restreint'))
);

CREATE INDEX repertoires_dossier_id_idx ON repertoires (dossier_id);

CREATE FUNCTION repertoires_parent_meme_dossier() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    parent_dossier UUID;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION 'repertoire parent cycle';
    END IF;
    SELECT dossier_id INTO parent_dossier FROM repertoires WHERE id = NEW.parent_id;
    IF parent_dossier IS NULL THEN
        RAISE EXCEPTION 'repertoire parent introuvable';
    END IF;
    IF parent_dossier IS DISTINCT FROM NEW.dossier_id THEN
        RAISE EXCEPTION 'repertoire parent hors dossier';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER repertoires_parent_meme_dossier_trg
    BEFORE INSERT OR UPDATE OF parent_id, dossier_id ON repertoires
    FOR EACH ROW
    EXECUTE FUNCTION repertoires_parent_meme_dossier();

ALTER TABLE documents ADD COLUMN repertoire_id UUID REFERENCES repertoires (id) ON DELETE RESTRICT;
ALTER TABLE documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE document_versions ADD COLUMN texte TEXT NOT NULL DEFAULT '';
ALTER TABLE document_versions ADD COLUMN parent_numero INTEGER;

CREATE TABLE document_versions_en_cours (
    document_id UUID NOT NULL REFERENCES documents (id) ON DELETE RESTRICT,
    numero INTEGER NOT NULL,
    parent_numero INTEGER,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (document_id, numero)
);

CREATE OR REPLACE FUNCTION propager_visibilite_documents() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite THEN
        UPDATE documents
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE document_versions
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE repertoires
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE parties SET visibilite = NEW.visibilite WHERE dossier_id = NEW.id;
        UPDATE temps_saisis
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE brouillons_facture
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE taux_horaires
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE intercalaires_personnalises
        SET visibilite = NEW.visibilite, restreint = NEW.restreint
        WHERE dossier_id = NEW.id;
        UPDATE intercalaire_elements
        SET visibilite = NEW.visibilite, restreint = NEW.restreint
        WHERE dossier_id = NEW.id;
        UPDATE dossier_liens AS lien
        SET visibilite = CASE
                WHEN a.visibilite = 'restreint' OR b.visibilite = 'restreint' THEN 'restreint'
                ELSE 'public'
            END,
            restreint = (a.visibilite = 'restreint' OR b.visibilite = 'restreint'),
            lie_restreint = (b.visibilite = 'restreint')
        FROM dossiers AS a, dossiers AS b
        WHERE lien.dossier_id = a.id
          AND lien.lie_a_id = b.id
          AND (lien.dossier_id = NEW.id OR lien.lie_a_id = NEW.id);
        UPDATE agenda_elements
        SET visibilite = NEW.visibilite, restreint = NEW.restreint
        WHERE dossier_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
