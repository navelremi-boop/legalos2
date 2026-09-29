-- Agenda (§ 4.2 n° 4) : audiences, rendez-vous, tâches, rappels. Ajouts seulement.
-- Les invitations reçues par mail restent au jalon J11.

CREATE TABLE agenda_elements (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    type_element TEXT NOT NULL,
    titre TEXT NOT NULL,
    debut TEXT NOT NULL,
    rappel_le TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    visibilite TEXT NOT NULL,
    restreint BOOLEAN NOT NULL DEFAULT FALSE,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agenda_elements_type_check
        CHECK (type_element IN ('audience', 'rendez_vous', 'tache')),
    CONSTRAINT agenda_elements_visibilite_check
        CHECK (visibilite IN ('public', 'restreint')),
    CONSTRAINT agenda_elements_restreint_visibilite
        CHECK (restreint = (visibilite = 'restreint'))
);

CREATE INDEX agenda_elements_dossier_idx ON agenda_elements (dossier_id);

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
