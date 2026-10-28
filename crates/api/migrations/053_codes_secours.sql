-- Codes de secours de la double authentification : empreinte seulement, usage unique.
CREATE TABLE codes_secours (
    id UUID PRIMARY KEY,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE CASCADE,
    empreinte TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    utilise_le TIMESTAMPTZ,
    CONSTRAINT codes_secours_empreinte_unique UNIQUE (utilisateur_id, empreinte)
);

CREATE INDEX codes_secours_utilisateur_idx ON codes_secours (utilisateur_id);
