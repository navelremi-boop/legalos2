CREATE TABLE sequences_factures (
    cabinet_id UUID PRIMARY KEY REFERENCES cabinets (id) ON DELETE RESTRICT,
    prochain BIGINT NOT NULL
);

CREATE TABLE factures (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    type TEXT NOT NULL,
    statut TEXT NOT NULL,
    numero BIGINT,
    facture_origine_id UUID REFERENCES factures (id),
    montant_ht_centimes BIGINT NOT NULL,
    montant_tva_centimes BIGINT NOT NULL,
    montant_ttc_centimes BIGINT NOT NULL,
    taux_tva_bp INTEGER NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT factures_type_check CHECK (type IN ('facture', 'avoir')),
    CONSTRAINT factures_statut_check CHECK (statut IN ('brouillon', 'validee')),
    CONSTRAINT factures_numero_unique UNIQUE (cabinet_id, numero)
);

CREATE TABLE facture_lignes (
    id UUID PRIMARY KEY,
    facture_id UUID NOT NULL REFERENCES factures (id) ON DELETE RESTRICT,
    libelle TEXT NOT NULL,
    nature TEXT NOT NULL,
    montant_ht_centimes BIGINT NOT NULL,
    CONSTRAINT facture_lignes_nature_check CHECK (nature IN ('honoraires', 'debours', 'frais'))
);

CREATE TABLE facture_encaissements (
    id UUID PRIMARY KEY,
    facture_id UUID NOT NULL REFERENCES factures (id) ON DELETE RESTRICT,
    montant_centimes BIGINT NOT NULL,
    cle_idempotence TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT facture_encaissements_cle_unique UNIQUE (cle_idempotence)
);

CREATE TABLE envois_plateforme (
    cle_idempotence TEXT PRIMARY KEY,
    facture_id UUID NOT NULL REFERENCES factures (id) ON DELETE RESTRICT,
    identifiant_pa TEXT NOT NULL
);

CREATE FUNCTION figer_facture_validee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.statut = 'validee' THEN
        RAISE EXCEPTION 'facture validee immuable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER factures_immuables
    BEFORE UPDATE ON factures
    FOR EACH ROW
    EXECUTE FUNCTION figer_facture_validee();
