-- Référence de dossier (§ 3.4) : année + numéro continu par cabinet, attribué côté serveur.
-- Colonne `reference` nullable (création hors ligne / lignes antérieures) jusqu'à attribution.
-- Une référence attribuée est immuable (déclencheur).

CREATE TABLE sequences_dossiers (
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    annee INTEGER NOT NULL,
    prochain BIGINT NOT NULL,
    PRIMARY KEY (cabinet_id, annee),
    CONSTRAINT sequences_dossiers_annee_check CHECK (annee >= 2000 AND annee <= 2100),
    CONSTRAINT sequences_dossiers_prochain_check CHECK (prochain >= 1)
);

ALTER TABLE dossiers ADD COLUMN reference TEXT;
ALTER TABLE dossiers ADD COLUMN reference_annee INTEGER;
ALTER TABLE dossiers ADD COLUMN reference_numero BIGINT;

CREATE UNIQUE INDEX dossiers_cabinet_reference_unique
    ON dossiers (cabinet_id, reference)
    WHERE reference IS NOT NULL;

CREATE UNIQUE INDEX dossiers_cabinet_annee_numero_unique
    ON dossiers (cabinet_id, reference_annee, reference_numero)
    WHERE reference_numero IS NOT NULL;

CREATE FUNCTION figer_reference_dossier() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.reference IS NOT NULL THEN
        IF NEW.reference IS DISTINCT FROM OLD.reference
            OR NEW.reference_annee IS DISTINCT FROM OLD.reference_annee
            OR NEW.reference_numero IS DISTINCT FROM OLD.reference_numero THEN
            RAISE EXCEPTION 'reference dossier immuable';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER dossiers_reference_immuable
    BEFORE UPDATE ON dossiers
    FOR EACH ROW
    EXECUTE FUNCTION figer_reference_dossier();
