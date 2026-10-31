-- Visibilité des encaissements, copiée de la facture, pour un flux sans jointure.

ALTER TABLE facture_encaissements ADD COLUMN cabinet_id UUID;
ALTER TABLE facture_encaissements ADD COLUMN visibilite TEXT;
ALTER TABLE facture_encaissements ADD COLUMN groupe_acces UUID;

UPDATE facture_encaissements AS e
SET cabinet_id = f.cabinet_id, visibilite = f.visibilite, groupe_acces = f.groupe_acces
FROM factures AS f
WHERE f.id = e.facture_id;

ALTER TABLE facture_encaissements ALTER COLUMN cabinet_id SET NOT NULL;
ALTER TABLE facture_encaissements ALTER COLUMN visibilite SET NOT NULL;

ALTER TABLE facture_encaissements ADD CONSTRAINT facture_encaissements_cabinet_fk
    FOREIGN KEY (cabinet_id) REFERENCES cabinets (id) ON DELETE RESTRICT;

ALTER TABLE facture_encaissements ADD CONSTRAINT facture_encaissements_visibilite_check
    CHECK (visibilite IN ('public', 'restreint'));

CREATE FUNCTION deduire_encaissement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cab UUID;
    v_vis TEXT;
    v_groupe UUID;
BEGIN
    SELECT cabinet_id, visibilite, groupe_acces
    INTO v_cab, v_vis, v_groupe
    FROM factures
    WHERE id = NEW.facture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'facture introuvable pour l''encaissement';
    END IF;
    NEW.cabinet_id := v_cab;
    NEW.visibilite := v_vis;
    NEW.groupe_acces := v_groupe;
    RETURN NEW;
END;
$$;

CREATE TRIGGER encaissements_deduit_visibilite
    BEFORE INSERT OR UPDATE OF facture_id ON facture_encaissements
    FOR EACH ROW EXECUTE FUNCTION deduire_encaissement();

CREATE FUNCTION propager_visibilite_encaissements() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite
        OR NEW.groupe_acces IS DISTINCT FROM OLD.groupe_acces THEN
        UPDATE facture_encaissements
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces
        WHERE facture_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER factures_visibilite_encaissements
    AFTER UPDATE OF visibilite, groupe_acces ON factures
    FOR EACH ROW EXECUTE FUNCTION propager_visibilite_encaissements();
