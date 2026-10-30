-- Fusion de doublons. Ajouts seulement.

ALTER TABLE contacts ADD COLUMN archivee BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN fusionnee_dans UUID REFERENCES contacts (id) ON DELETE RESTRICT;

ALTER TABLE contacts ADD CONSTRAINT contacts_fusion_archivee_check
    CHECK (fusionnee_dans IS NULL OR archivee);

ALTER TABLE factures ADD COLUMN contact_id UUID REFERENCES contacts (id) ON DELETE RESTRICT;

CREATE TABLE message_contacts (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    message_id UUID NOT NULL REFERENCES messages (id) ON DELETE RESTRICT,
    contact_id UUID NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    role TEXT NOT NULL,
    CONSTRAINT message_contacts_role_check CHECK (role IN ('expediteur', 'destinataire')),
    CONSTRAINT message_contacts_unique UNIQUE (message_id, contact_id, role)
);
