CREATE TABLE utilisateurs (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret_chiffre TEXT,
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT utilisateurs_cabinet_email_unique UNIQUE (cabinet_id, email)
);

CREATE INDEX utilisateurs_cabinet_id_idx ON utilisateurs (cabinet_id);
