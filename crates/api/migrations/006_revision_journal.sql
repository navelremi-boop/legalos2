ALTER TABLE cabinets
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;

CREATE TABLE journal_modifications (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id),
    table_cible TEXT NOT NULL,
    enregistrement_id UUID NOT NULL,
    champ TEXT NOT NULL,
    valeur_remplacee TEXT,
    valeur_appliquee TEXT NOT NULL,
    revision_base BIGINT NOT NULL,
    revision_appliquee BIGINT NOT NULL,
    poste_id UUID,
    conflit BOOLEAN NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX journal_modifications_champ_idx
    ON journal_modifications (enregistrement_id, champ, revision_appliquee);

CREATE TABLE upload_idempotence (
    cle TEXT PRIMARY KEY,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
