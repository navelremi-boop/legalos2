-- Contenus de messages (étape 3) : HTML nettoyé + texte brut pour la recherche.
-- Aucun secret IMAP. Index français côté serveur.

CREATE TABLE contenus_messages (
    message_id_ref UUID PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    html_nettoye TEXT NOT NULL DEFAULT '',
    texte_brut TEXT NOT NULL DEFAULT '',
    texte_tsv tsvector GENERATED ALWAYS AS (to_tsvector('french', coalesce(texte_brut, ''))) STORED,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contenus_messages_cabinet_idx ON contenus_messages (cabinet_id);
CREATE INDEX contenus_messages_tsv_idx ON contenus_messages USING GIN (texte_tsv);

ALTER TABLE messages ADD COLUMN dossier_imap TEXT NOT NULL DEFAULT 'INBOX';
ALTER TABLE messages ADD COLUMN drapeaux TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN lu BOOLEAN NOT NULL DEFAULT FALSE;
