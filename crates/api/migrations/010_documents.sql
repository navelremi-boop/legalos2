CREATE TABLE documents (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    nom TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX documents_dossier_id_idx ON documents (dossier_id);

CREATE TABLE document_versions (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents (id) ON DELETE RESTRICT,
    numero INTEGER NOT NULL,
    empreinte TEXT NOT NULL,
    taille BIGINT NOT NULL,
    auteur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    cle_objet TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT document_versions_numero_unique UNIQUE (document_id, numero)
);
