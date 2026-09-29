-- Dossiers et contacts complets (§ 4.2 n° 1 et 2). Ajouts seulement.
-- type_dossier et etape sont des libellés de classement du cabinet, pas des catégories du CPC.

ALTER TABLE dossiers ADD COLUMN type_dossier TEXT NOT NULL DEFAULT 'autre';
ALTER TABLE dossiers ADD COLUMN etape TEXT NOT NULL DEFAULT 'ouverture';

ALTER TABLE dossiers ADD CONSTRAINT dossiers_type_dossier_check
    CHECK (type_dossier IN ('contentieux', 'conseil', 'autre'));
ALTER TABLE dossiers ADD CONSTRAINT dossiers_etape_check
    CHECK (etape IN ('ouverture', 'instruction', 'plaidoirie', 'jugement', 'execution', 'clos'));

CREATE TABLE contacts (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    nature TEXT NOT NULL,
    nom TEXT NOT NULL,
    siren TEXT,
    numero_tva TEXT,
    type_client TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT contacts_nature_check CHECK (nature IN ('physique', 'morale')),
    CONSTRAINT contacts_type_client_check
        CHECK (type_client IN ('professionnel', 'particulier', 'etranger'))
);

CREATE INDEX contacts_cabinet_idx ON contacts (cabinet_id);

ALTER TABLE parties ADD COLUMN contact_id UUID REFERENCES contacts (id) ON DELETE RESTRICT;

CREATE TABLE dossier_liens (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    lie_a_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    revision BIGINT NOT NULL DEFAULT 1,
    visibilite TEXT NOT NULL,
    restreint BOOLEAN NOT NULL DEFAULT FALSE,
    -- Cible restreinte : le flux restreint exige aussi l'accès à lie_a_id.
    lie_restreint BOOLEAN NOT NULL DEFAULT FALSE,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT dossier_liens_distinct CHECK (dossier_id <> lie_a_id),
    CONSTRAINT dossier_liens_unique UNIQUE (dossier_id, lie_a_id),
    CONSTRAINT dossier_liens_visibilite_check CHECK (visibilite IN ('public', 'restreint')),
    CONSTRAINT dossier_liens_restreint_visibilite
        CHECK (restreint = (visibilite = 'restreint'))
);

CREATE INDEX dossier_liens_dossier_idx ON dossier_liens (dossier_id);
CREATE INDEX dossier_liens_lie_idx ON dossier_liens (lie_a_id);

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
    END IF;
    RETURN NEW;
END;
$$;
