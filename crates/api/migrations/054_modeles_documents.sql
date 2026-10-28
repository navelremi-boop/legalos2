-- Modèles de documents du cabinet (courrier, convention, acte).
-- Le fichier est dans le stockage objet ; cette table n'en garde que l'empreinte.

CREATE TABLE modeles_documents (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    genre TEXT NOT NULL,
    empreinte TEXT NOT NULL,
    taille BIGINT NOT NULL,
    cle_objet TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT modeles_documents_genre_check
        CHECK (genre IN ('courrier', 'convention', 'acte')),
    CONSTRAINT modeles_documents_cabinet_genre UNIQUE (cabinet_id, genre)
);
