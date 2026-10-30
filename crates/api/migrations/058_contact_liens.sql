-- Liens entre contacts. Ajouts seulement.

CREATE TABLE contact_liens (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    contact_source_id UUID NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    contact_cible_id UUID NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    type_lien TEXT NOT NULL,
    fonction TEXT,
    libelle TEXT,
    represente_societe BOOLEAN NOT NULL DEFAULT FALSE,
    pour_le_compte_de UUID REFERENCES contacts (id) ON DELETE RESTRICT,
    debut TEXT,
    fin TEXT,
    source TEXT,
    note TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT contact_liens_type_check CHECK (
        type_lien IN (
            'mandat_social',
            'representant_permanent',
            'associe',
            'salarie',
            'conjoint_pacs',
            'parent',
            'expert_comptable',
            'commissaire_comptes',
            'autre'
        )
    ),
    CONSTRAINT contact_liens_distinct CHECK (contact_source_id <> contact_cible_id),
    CONSTRAINT contact_liens_dates_check CHECK (
        fin IS NULL OR (debut IS NOT NULL AND fin > debut)
    )
);

CREATE INDEX contact_liens_source_idx ON contact_liens (contact_source_id);
CREATE INDEX contact_liens_cible_idx ON contact_liens (contact_cible_id);

CREATE UNIQUE INDEX contact_liens_represente_idx
    ON contact_liens (contact_cible_id, fonction)
    WHERE represente_societe AND fin IS NULL AND type_lien = 'mandat_social';
