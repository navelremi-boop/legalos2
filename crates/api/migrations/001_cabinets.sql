CREATE TABLE cabinets (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL,
    nom TEXT NOT NULL,
    totp_obligatoire BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cabinets_slug_unique UNIQUE (slug)
);
