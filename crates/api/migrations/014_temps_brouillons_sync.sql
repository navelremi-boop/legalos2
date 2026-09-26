-- Temps saisis et brouillons synchronisés (J8) : dossier_id + copie de visibilité.
-- Taux horaire paramétrable (client / dossier / intervenant).

CREATE TABLE taux_horaires (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    client_partie_id UUID REFERENCES parties (id) ON DELETE RESTRICT,
    dossier_id UUID REFERENCES dossiers (id) ON DELETE RESTRICT,
    intervenant_id UUID REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    centimes_par_heure BIGINT NOT NULL,
    visibilite TEXT NOT NULL DEFAULT 'public',
    dossier_texte TEXT,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT taux_horaires_positif CHECK (centimes_par_heure > 0)
);

CREATE INDEX taux_horaires_cabinet_idx ON taux_horaires (cabinet_id);
CREATE INDEX taux_horaires_dossier_idx ON taux_horaires (dossier_id);

CREATE TABLE temps_saisis (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    intervenant_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    minutes INTEGER NOT NULL,
    libelle TEXT NOT NULL,
    taux_centimes_heure BIGINT NOT NULL,
    ht_centimes BIGINT NOT NULL,
    visibilite TEXT NOT NULL,
    dossier_texte TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT temps_saisis_minutes_positif CHECK (minutes > 0),
    CONSTRAINT temps_saisis_taux_positif CHECK (taux_centimes_heure > 0)
);

CREATE INDEX temps_saisis_dossier_idx ON temps_saisis (dossier_id);
CREATE INDEX temps_saisis_cabinet_idx ON temps_saisis (cabinet_id);

CREATE TABLE brouillons_facture (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    temps_id UUID REFERENCES temps_saisis (id) ON DELETE RESTRICT,
    numero BIGINT,
    ht_centimes BIGINT NOT NULL,
    libelle TEXT NOT NULL,
    intervenant_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    taux_centimes_heure BIGINT NOT NULL,
    visibilite TEXT NOT NULL,
    dossier_texte TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT brouillons_facture_ht_positif CHECK (ht_centimes > 0),
    CONSTRAINT brouillons_facture_taux_positif CHECK (taux_centimes_heure > 0)
);

CREATE INDEX brouillons_facture_dossier_idx ON brouillons_facture (dossier_id);
CREATE INDEX brouillons_facture_cabinet_idx ON brouillons_facture (cabinet_id);

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
    END IF;
    RETURN NEW;
END;
$$;
