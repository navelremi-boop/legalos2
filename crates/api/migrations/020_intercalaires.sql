-- Intercalaires personnalisés (§ 7.4) : classement supplémentaire, pas un déplacement du chrono.

CREATE TABLE intercalaires_personnalises (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    nom TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    visibilite TEXT NOT NULL,
    restreint BOOLEAN NOT NULL DEFAULT FALSE,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT intercalaires_personnalises_visibilite_check
        CHECK (visibilite IN ('public', 'restreint')),
    CONSTRAINT intercalaires_personnalises_restreint_visibilite
        CHECK (restreint = (visibilite = 'restreint'))
);

CREATE INDEX intercalaires_personnalises_dossier_idx
    ON intercalaires_personnalises (dossier_id);
CREATE INDEX intercalaires_personnalises_cabinet_idx
    ON intercalaires_personnalises (cabinet_id);

CREATE TABLE intercalaire_elements (
    id UUID PRIMARY KEY,
    intercalaire_id UUID NOT NULL REFERENCES intercalaires_personnalises (id) ON DELETE CASCADE,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    type_element TEXT NOT NULL,
    element_id UUID NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    visibilite TEXT NOT NULL,
    restreint BOOLEAN NOT NULL DEFAULT FALSE,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT intercalaire_elements_type_check
        CHECK (type_element IN ('mail', 'piece', 'facture', 'audience', 'note')),
    CONSTRAINT intercalaire_elements_visibilite_check
        CHECK (visibilite IN ('public', 'restreint')),
    CONSTRAINT intercalaire_elements_restreint_visibilite
        CHECK (restreint = (visibilite = 'restreint')),
    CONSTRAINT intercalaire_elements_unique
        UNIQUE (intercalaire_id, type_element, element_id)
);

CREATE INDEX intercalaire_elements_intercalaire_idx
    ON intercalaire_elements (intercalaire_id);
CREATE INDEX intercalaire_elements_dossier_idx
    ON intercalaire_elements (dossier_id);

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
    END IF;
    RETURN NEW;
END;
$$;
