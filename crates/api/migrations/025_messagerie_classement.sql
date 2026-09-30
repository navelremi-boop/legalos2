-- Messagerie étape 1 : boîte de classement, messages, curseur de relève.
-- Uniquement additif. Identifiants IMAP jamais exposés au poste (secret_ref serveur).

ALTER TABLE contacts ADD COLUMN email TEXT;

CREATE UNIQUE INDEX contacts_cabinet_email_unique
    ON contacts (cabinet_id, lower(email))
    WHERE email IS NOT NULL;

CREATE TABLE comptes_mail (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    type_compte TEXT NOT NULL,
    titulaire_id UUID REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    adresse TEXT NOT NULL,
    secret_ref TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT comptes_mail_type_check
        CHECK (type_compte IN ('classement', 'nominatif', 'partage'))
);

CREATE INDEX comptes_mail_cabinet_idx ON comptes_mail (cabinet_id);
CREATE UNIQUE INDEX comptes_mail_classement_unique
    ON comptes_mail (cabinet_id)
    WHERE type_compte = 'classement';

CREATE TABLE releve_curseurs (
    compte_id UUID NOT NULL REFERENCES comptes_mail (id) ON DELETE CASCADE,
    dossier_imap TEXT NOT NULL DEFAULT 'INBOX',
    uid_validity BIGINT NOT NULL DEFAULT 0,
    dernier_uid BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (compte_id, dossier_imap)
);

CREATE TABLE messages (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    compte_id UUID NOT NULL REFERENCES comptes_mail (id) ON DELETE RESTRICT,
    dossier_id UUID REFERENCES dossiers (id) ON DELETE RESTRICT,
    message_id TEXT NOT NULL,
    uid_validity BIGINT NOT NULL,
    uid BIGINT NOT NULL,
    objet TEXT NOT NULL DEFAULT '',
    expediteur TEXT NOT NULL DEFAULT '',
    etat_classement TEXT NOT NULL,
    suggestion_dossier_id UUID REFERENCES dossiers (id) ON DELETE RESTRICT,
    visibilite TEXT NOT NULL,
    restreint BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT messages_etat_check
        CHECK (etat_classement IN ('classe', 'suggestion', 'a_classer')),
    CONSTRAINT messages_visibilite_check
        CHECK (visibilite IN ('public', 'restreint')),
    CONSTRAINT messages_restreint_visibilite
        CHECK (restreint = (visibilite = 'restreint')),
    CONSTRAINT messages_compte_message_id_unique UNIQUE (compte_id, message_id),
    CONSTRAINT messages_compte_uid_unique UNIQUE (compte_id, uid_validity, uid)
);

CREATE INDEX messages_cabinet_idx ON messages (cabinet_id);
CREATE INDEX messages_dossier_idx ON messages (dossier_id);
CREATE INDEX messages_etat_idx ON messages (cabinet_id, etat_classement);

CREATE OR REPLACE FUNCTION propager_visibilite_documents() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite THEN
        UPDATE documents
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE document_versions
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE repertoires
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE parties SET visibilite = NEW.visibilite WHERE dossier_id = NEW.id;
        UPDATE temps_saisis
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE brouillons_facture
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE taux_horaires
        SET visibilite = NEW.visibilite, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE intercalaires_personnalises
        SET visibilite = NEW.visibilite, restreint = NEW.restreint
        WHERE dossier_id = NEW.id;
        UPDATE intercalaire_elements
        SET visibilite = NEW.visibilite, restreint = NEW.restreint
        WHERE dossier_id = NEW.id;
        UPDATE dossier_liens AS lien
        SET visibilite = CASE
                WHEN a.visibilite = 'restreint' OR b.visibilite = 'restreint' THEN 'restreint'
                ELSE 'public'
            END,
            restreint = (a.visibilite = 'restreint' OR b.visibilite = 'restreint'),
            lie_restreint = (b.visibilite = 'restreint')
        FROM dossiers AS a, dossiers AS b
        WHERE lien.dossier_id = a.id
          AND lien.lie_a_id = b.id
          AND (lien.dossier_id = NEW.id OR lien.lie_a_id = NEW.id);
        UPDATE agenda_elements
        SET visibilite = NEW.visibilite, restreint = NEW.restreint
        WHERE dossier_id = NEW.id;
        UPDATE messages
        SET visibilite = NEW.visibilite, restreint = (NEW.visibilite = 'restreint')
        WHERE dossier_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
