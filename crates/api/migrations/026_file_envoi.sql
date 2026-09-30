-- File d'envoi (§ 3.8.3). Message-ID généré une seule fois à l'insertion.

CREATE TABLE file_envoi (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    compte_id UUID NOT NULL REFERENCES comptes_mail (id) ON DELETE RESTRICT,
    dossier_id UUID REFERENCES dossiers (id) ON DELETE RESTRICT,
    message_id TEXT NOT NULL,
    destinataire TEXT NOT NULL,
    objet TEXT NOT NULL DEFAULT '',
    corps TEXT NOT NULL DEFAULT '',
    etat TEXT NOT NULL,
    tentatives INTEGER NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT file_envoi_etat_check CHECK (
        etat IN (
            'brouillon',
            'en_attente',
            'envoye',
            'copie_envoyes_confirmee',
            'echec'
        )
    ),
    CONSTRAINT file_envoi_message_id_unique UNIQUE (compte_id, message_id)
);

CREATE INDEX file_envoi_cabinet_idx ON file_envoi (cabinet_id);
CREATE INDEX file_envoi_etat_idx ON file_envoi (cabinet_id, etat);
