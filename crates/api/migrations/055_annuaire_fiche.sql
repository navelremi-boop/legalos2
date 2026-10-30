-- Fiche d'annuaire : identité, profession réglementée, coordonnées. Ajouts seulement.

ALTER TABLE contacts ADD COLUMN civilite TEXT;
ALTER TABLE contacts ADD COLUMN accord TEXT;
ALTER TABLE contacts ADD COLUMN prenoms TEXT;
ALTER TABLE contacts ADD COLUMN nom_naissance TEXT;
ALTER TABLE contacts ADD COLUMN date_naissance TEXT;
ALTER TABLE contacts ADD COLUMN lieu_naissance TEXT;
ALTER TABLE contacts ADD COLUMN nationalite TEXT;
ALTER TABLE contacts ADD COLUMN profession TEXT;
ALTER TABLE contacts ADD COLUMN forme TEXT;
ALTER TABLE contacts ADD COLUMN capital_centimes BIGINT;
ALTER TABLE contacts ADD COLUMN monnaie TEXT;
ALTER TABLE contacts ADD COLUMN greffe_rcs TEXT;
ALTER TABLE contacts ADD COLUMN activite TEXT;
ALTER TABLE contacts ADD COLUMN profession_reglementee TEXT;
ALTER TABLE contacts ADD COLUMN barreau TEXT;
ALTER TABLE contacts ADD COLUMN toque TEXT;
ALTER TABLE contacts ADD COLUMN specialite TEXT;
ALTER TABLE contacts ADD COLUMN cour_appel TEXT;

ALTER TABLE contacts ADD CONSTRAINT contacts_accord_check
    CHECK (accord IS NULL OR accord IN ('masculin', 'feminin'));
ALTER TABLE contacts ADD CONSTRAINT contacts_civilite_check
    CHECK (civilite IS NULL OR lower(civilite) <> 'mademoiselle');
ALTER TABLE contacts ADD CONSTRAINT contacts_profession_reglementee_check
    CHECK (
        profession_reglementee IS NULL
        OR profession_reglementee IN (
            'avocat',
            'commissaire_justice',
            'notaire',
            'expert_judiciaire',
            'administrateur_judiciaire',
            'mandataire_judiciaire',
            'expert_comptable',
            'commissaire_comptes'
        )
    );
ALTER TABLE contacts ADD CONSTRAINT contacts_capital_check
    CHECK (capital_centimes IS NULL OR capital_centimes >= 0);
ALTER TABLE contacts ADD CONSTRAINT contacts_date_naissance_check
    CHECK (date_naissance IS NULL OR date_naissance ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

CREATE TABLE contact_coordonnees (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    contact_id UUID NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    genre TEXT NOT NULL,
    usage TEXT NOT NULL,
    valeur TEXT NOT NULL,
    principale BOOLEAN NOT NULL DEFAULT FALSE,
    pays TEXT,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT contact_coordonnees_genre_check
        CHECK (genre IN ('adresse', 'telephone', 'email', 'site')),
    CONSTRAINT contact_coordonnees_usage_check
        CHECK (usage IN ('domicile', 'siege', 'correspondance', 'facturation', 'cabinet', 'etude', 'autre'))
);

CREATE INDEX contact_coordonnees_contact_idx ON contact_coordonnees (contact_id);
CREATE UNIQUE INDEX contact_coordonnees_principale_idx
    ON contact_coordonnees (contact_id, genre)
    WHERE principale;
