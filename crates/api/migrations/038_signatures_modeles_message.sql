-- Rédaction (J11, étape 1a) : signatures, modèles de message, composition d'un envoi.
-- Uniquement additif. Rien de ce fichier n'est synchronisé vers le poste.

-- Une signature par compte de messagerie et par utilisateur : texte et HTML (nettoyé à l'écriture).
-- Un compte nominatif n'a de signature que pour son titulaire ; la contrainte est tenue par l'API.
CREATE TABLE signatures_messagerie (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    compte_id UUID NOT NULL REFERENCES comptes_mail (id) ON DELETE RESTRICT,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    texte TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT signatures_messagerie_unique UNIQUE (compte_id, utilisateur_id)
);

CREATE INDEX signatures_messagerie_utilisateur_idx
    ON signatures_messagerie (utilisateur_id);

-- Modèles de message du cabinet : nom, objet, corps HTML (nettoyé à l'écriture), ordre, actif.
CREATE TABLE modeles_message (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    nom TEXT NOT NULL,
    objet TEXT NOT NULL DEFAULT '',
    corps_html TEXT NOT NULL DEFAULT '',
    ordre INTEGER NOT NULL DEFAULT 0,
    actif BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    modifie_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT modeles_message_nom_non_vide CHECK (btrim(nom) <> '')
);

CREATE UNIQUE INDEX modeles_message_nom_unique
    ON modeles_message (cabinet_id, lower(nom));
CREATE INDEX modeles_message_cabinet_idx
    ON modeles_message (cabinet_id, actif, ordre);

-- File d'envoi : l'auteur (seul à lire ou modifier son brouillon), les trois champs
-- d'adresses, le corps HTML, le fil de discussion et l'origine d'une réponse ou d'un transfert.
-- `destinataire` reste le champ « à » (adresses séparées par un retour à la ligne, jamais
-- présent dans une adresse validée) ; les lignes antérieures n'ont pas d'auteur.
ALTER TABLE file_envoi ADD COLUMN auteur_id UUID REFERENCES utilisateurs (id);
ALTER TABLE file_envoi ADD COLUMN cc TEXT NOT NULL DEFAULT '';
ALTER TABLE file_envoi ADD COLUMN cci TEXT NOT NULL DEFAULT '';
ALTER TABLE file_envoi ADD COLUMN corps_html TEXT NOT NULL DEFAULT '';
ALTER TABLE file_envoi ADD COLUMN genre TEXT NOT NULL DEFAULT 'nouveau';
ALTER TABLE file_envoi ADD COLUMN origine_message_id UUID REFERENCES messages (id) ON DELETE SET NULL;
ALTER TABLE file_envoi ADD COLUMN en_reponse_a TEXT;
ALTER TABLE file_envoi ADD COLUMN references_texte TEXT NOT NULL DEFAULT '';

ALTER TABLE file_envoi ADD CONSTRAINT file_envoi_genre_check
    CHECK (genre IN ('nouveau', 'reponse', 'reponse_a_tous', 'transfert'));

CREATE INDEX file_envoi_auteur_idx ON file_envoi (auteur_id) WHERE auteur_id IS NOT NULL;

-- Pièces d'un envoi (reprises de l'original au transfert). Le contenu n'est jamais journalisé.
CREATE TABLE file_envoi_pieces (
    id UUID PRIMARY KEY,
    envoi_id UUID NOT NULL REFERENCES file_envoi (id) ON DELETE CASCADE,
    ordre INTEGER NOT NULL,
    nom TEXT NOT NULL,
    type_mime TEXT NOT NULL,
    contenu BYTEA NOT NULL,
    CONSTRAINT file_envoi_pieces_ordre_unique UNIQUE (envoi_id, ordre)
);
