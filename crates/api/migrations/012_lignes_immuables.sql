CREATE FUNCTION figer_lignes_facture_validee() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    parent UUID;
    statut_parent TEXT;
BEGIN
    parent := COALESCE(NEW.facture_id, OLD.facture_id);
    SELECT statut INTO statut_parent FROM factures WHERE id = parent;
    IF statut_parent = 'validee' THEN
        RAISE EXCEPTION 'facture validee immuable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER facture_lignes_immuables
    BEFORE INSERT OR UPDATE OR DELETE ON facture_lignes
    FOR EACH ROW
    EXECUTE FUNCTION figer_lignes_facture_validee();
