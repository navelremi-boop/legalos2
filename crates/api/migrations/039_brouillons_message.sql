-- Rédaction (J11, étape 1b) : brouillons de message, propres à leur auteur.
-- Uniquement additif. `brouillons_message` est synchronisée vers le poste de son auteur seul
-- (flux `brouillons_titulaire`) ; `brouillons_message_pieces` ne l'est jamais (contenu binaire).

-- Un brouillon : l'identifiant est fourni par le client (écriture rejouable). Le `Message-ID` est
-- figé à la création et repris tel quel par l'envoi. Les adresses sont une par ligne, comme dans
-- `file_envoi`. Une seule personne écrit un brouillon : dernière écriture gagnante, pas de
-- contrôle de révision.
CREATE TABLE brouillons_message (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    auteur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    compte_id UUID NOT NULL REFERENCES comptes_mail (id) ON DELETE RESTRICT,
    genre TEXT NOT NULL DEFAULT 'nouveau',
    origine_message_id UUID REFERENCES messages (id) ON DELETE SET NULL,
    dossier_id UUID REFERENCES dossiers (id) ON DELETE SET NULL,
    a TEXT NOT NULL DEFAULT '',
    cc TEXT NOT NULL DEFAULT '',
    cci TEXT NOT NULL DEFAULT '',
    objet TEXT NOT NULL DEFAULT '',
    corps_html TEXT NOT NULL DEFAULT '',
    corps TEXT NOT NULL DEFAULT '',
    message_id TEXT NOT NULL,
    en_reponse_a TEXT,
    references_texte TEXT NOT NULL DEFAULT '',
    -- Résumé JSON des pièces ([{id, nom, type_mime, taille}]), tenu par l'API.
    pieces_texte TEXT NOT NULL DEFAULT '[]',
    -- Adresse d'expéditeur figée à la création (identité de l'envoi). Non synchronisée.
    expediteur TEXT NOT NULL DEFAULT '',
    -- Copie dans le dossier Brouillons du serveur IMAP. Non synchronisée. `a_retirer` : brouillon
    -- supprimé ou envoyé dont la copie IMAP n'est pas encore retirée (masqué du poste et de l'API).
    imap_etat TEXT NOT NULL DEFAULT 'a_deposer',
    imap_maj_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT brouillons_message_genre_check
        CHECK (genre IN ('nouveau', 'reponse', 'reponse_a_tous', 'transfert')),
    CONSTRAINT brouillons_message_imap_etat_check
        CHECK (imap_etat IN ('a_deposer', 'depose', 'erreur', 'a_retirer')),
    CONSTRAINT brouillons_message_compte_message_id_unique UNIQUE (compte_id, message_id)
);

CREATE INDEX brouillons_message_auteur_idx ON brouillons_message (auteur_id, modifie_le DESC);
CREATE INDEX brouillons_message_a_deposer_idx
    ON brouillons_message (imap_maj_le) WHERE imap_etat <> 'depose';

-- Pièces d'un brouillon (contenu jamais journalisé ni synchronisé). 25 Mio cumulés au plus par
-- brouillon : limite tenue par l'API sous verrou de la ligne du brouillon.
CREATE TABLE brouillons_message_pieces (
    id UUID PRIMARY KEY,
    brouillon_id UUID NOT NULL REFERENCES brouillons_message (id) ON DELETE CASCADE,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    ordre INTEGER NOT NULL,
    nom TEXT NOT NULL,
    type_mime TEXT NOT NULL,
    taille INTEGER NOT NULL,
    contenu BYTEA NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT brouillons_message_pieces_ordre_unique UNIQUE (brouillon_id, ordre),
    CONSTRAINT brouillons_message_pieces_taille_check CHECK (taille >= 0)
);
