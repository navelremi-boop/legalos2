-- Notes de la fiche, communes au cabinet, pour un flux sans jointure.

CREATE TABLE contact_notes (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    contact_id UUID NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    texte TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT contact_notes_texte_non_vide CHECK (length(btrim(texte)) > 0)
);

CREATE INDEX contact_notes_contact_idx ON contact_notes (contact_id);
