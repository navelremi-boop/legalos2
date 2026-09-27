-- Modèle de référence personnalisable (R0, docs/hypotheses-dossiers.md).
-- Uniquement additif : colonnes, table continue, forme de classement.
-- La forme de classement reprend forme_classement + majuscules. Elle n'est pas
-- GENERATED ALWAYS : un INSERT qui recopie toutes les colonnes (contrôleur,
-- jsonb_populate_record) devrait encore buter sur l'unicité, pas sur 428C9.

ALTER TABLE cabinets
    ADD COLUMN reference_modele TEXT NOT NULL DEFAULT '{AAAA}-{N:3}';

ALTER TABLE cabinets
    ADD COLUMN reference_remise_a_zero TEXT NOT NULL DEFAULT 'annuelle';

ALTER TABLE cabinets
    ADD CONSTRAINT cabinets_reference_remise_a_zero_check
    CHECK (reference_remise_a_zero IN ('annuelle', 'jamais'));

ALTER TABLE utilisateurs
    ADD COLUMN initiales TEXT;

ALTER TABLE utilisateurs
    ADD CONSTRAINT utilisateurs_initiales_check
    CHECK (initiales IS NULL OR initiales ~ '^[A-Z]{1,4}$');

CREATE TABLE sequences_dossiers_continues (
    cabinet_id UUID PRIMARY KEY REFERENCES cabinets (id) ON DELETE RESTRICT,
    prochain BIGINT NOT NULL,
    CONSTRAINT sequences_dossiers_continues_prochain_check CHECK (prochain >= 1)
);

ALTER TABLE dossiers ADD COLUMN reference_classement TEXT;

CREATE FUNCTION calculer_reference_classement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.reference IS NULL THEN
        NEW.reference_classement := NULL;
    ELSE
        NEW.reference_classement :=
            upper(regexp_replace(NEW.reference, '[^A-Za-z0-9_-]', '-', 'g'));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER dossiers_reference_classement
    BEFORE INSERT OR UPDATE OF reference, reference_classement ON dossiers
    FOR EACH ROW
    EXECUTE FUNCTION calculer_reference_classement();

UPDATE dossiers
SET reference_classement = upper(regexp_replace(reference, '[^A-Za-z0-9_-]', '-', 'g'))
WHERE reference IS NOT NULL;

CREATE UNIQUE INDEX dossiers_cabinet_classement_unique
    ON dossiers (cabinet_id, reference_classement)
    WHERE reference_classement IS NOT NULL;
