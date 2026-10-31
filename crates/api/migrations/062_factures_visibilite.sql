-- Visibilité des factures, copiée du dossier, pour un flux sans jointure.
-- Une facture validée reste immuable sur ses montants. La visibilité suit le dossier.

ALTER TABLE factures ADD COLUMN visibilite TEXT NOT NULL DEFAULT 'public';
ALTER TABLE factures ADD COLUMN groupe_acces UUID;

ALTER TABLE factures ADD CONSTRAINT factures_visibilite_check
    CHECK (visibilite IN ('public', 'restreint'));

CREATE OR REPLACE FUNCTION figer_facture_validee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.statut = 'validee' AND (
        NEW.montant_ht_centimes IS DISTINCT FROM OLD.montant_ht_centimes
        OR NEW.montant_tva_centimes IS DISTINCT FROM OLD.montant_tva_centimes
        OR NEW.montant_ttc_centimes IS DISTINCT FROM OLD.montant_ttc_centimes
        OR NEW.taux_tva_bp IS DISTINCT FROM OLD.taux_tva_bp
        OR NEW.statut IS DISTINCT FROM OLD.statut
        OR NEW.numero IS DISTINCT FROM OLD.numero
        OR NEW.type IS DISTINCT FROM OLD.type
        OR NEW.type_client IS DISTINCT FROM OLD.type_client
        OR NEW.dossier_id IS DISTINCT FROM OLD.dossier_id
        OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
        OR NEW.facture_origine_id IS DISTINCT FROM OLD.facture_origine_id
        OR NEW.cabinet_id IS DISTINCT FROM OLD.cabinet_id
    ) THEN
        RAISE EXCEPTION 'facture validee immuable';
    END IF;
    RETURN NEW;
END;
$$;

UPDATE factures AS f
SET visibilite = d.visibilite, groupe_acces = d.groupe_acces
FROM dossiers AS d
WHERE d.id = f.dossier_id;

CREATE TRIGGER factures_deduit_visibilite
    BEFORE INSERT OR UPDATE OF dossier_id ON factures
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();

CREATE FUNCTION propager_visibilite_factures() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite
        OR NEW.groupe_acces IS DISTINCT FROM OLD.groupe_acces THEN
        UPDATE factures
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces
        WHERE dossier_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER dossiers_visibilite_factures
    AFTER UPDATE OF visibilite, groupe_acces ON dossiers
    FOR EACH ROW EXECUTE FUNCTION propager_visibilite_factures();
