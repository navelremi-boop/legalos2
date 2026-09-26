-- Type de client (émission PA vs e-reporting) et artefacts PDF + Factur-X figés à la validation.

ALTER TABLE factures
    ADD COLUMN type_client TEXT NOT NULL DEFAULT 'professionnel';

ALTER TABLE factures
    ADD CONSTRAINT factures_type_client_check
    CHECK (type_client IN ('professionnel', 'particulier', 'etranger'));

CREATE TABLE facture_artefacts (
    facture_id UUID PRIMARY KEY REFERENCES factures (id) ON DELETE RESTRICT,
    cii_xml TEXT NOT NULL,
    pdf_octets BYTEA NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
