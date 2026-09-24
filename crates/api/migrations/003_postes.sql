CREATE TABLE postes (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    nom_appareil TEXT NOT NULL,
    revoque_le TIMESTAMPTZ,
    derniere_connexion_le TIMESTAMPTZ,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT postes_cabinet_utilisateur_appareil_unique UNIQUE (cabinet_id, utilisateur_id, nom_appareil)
);

CREATE INDEX postes_cabinet_id_idx ON postes (cabinet_id);
CREATE INDEX postes_utilisateur_id_idx ON postes (utilisateur_id);
