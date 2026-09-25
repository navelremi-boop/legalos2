CREATE TABLE dossiers (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    nom TEXT NOT NULL,
    chemise TEXT NOT NULL,
    juridiction TEXT NOT NULL,
    numero_rg TEXT NOT NULL,
    restreint BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dossiers_cabinet_id_idx ON dossiers (cabinet_id);

CREATE TABLE parties (
    id UUID PRIMARY KEY,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    role TEXT NOT NULL,
    nom TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX parties_dossier_id_idx ON parties (dossier_id);

CREATE TABLE dossier_acces (
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    PRIMARY KEY (dossier_id, utilisateur_id)
);
