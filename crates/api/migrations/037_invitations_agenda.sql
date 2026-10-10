-- Invitations reçues par mail (J11). Visibles du seul titulaire, sans dossier.

CREATE TABLE invitations_agenda (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    titulaire_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    uid_ical TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    effet TEXT NOT NULL,
    fuseau TEXT NOT NULL,
    debut TEXT NOT NULL,
    fin TEXT,
    objet TEXT NOT NULL DEFAULT '',
    organisateur TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT invitations_agenda_effet_check
        CHECK (effet IN ('demande', 'mise_a_jour', 'annulation')),
    CONSTRAINT invitations_agenda_uid_unique UNIQUE (titulaire_id, uid_ical)
);

CREATE INDEX invitations_agenda_titulaire_idx ON invitations_agenda (titulaire_id);
