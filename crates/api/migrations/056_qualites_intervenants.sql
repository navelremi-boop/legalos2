-- Qualités du cabinet et intervenants d'un dossier. Ajouts seulement.

CREATE TABLE qualites (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    libelle TEXT NOT NULL,
    admet_rattachement BOOLEAN NOT NULL,
    archivee BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT qualites_cabinet_code UNIQUE (cabinet_id, code)
);

CREATE INDEX qualites_cabinet_idx ON qualites (cabinet_id);

CREATE FUNCTION inserer_qualites_cabinet(p_cabinet UUID) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO qualites (id, cabinet_id, code, libelle, admet_rattachement)
    SELECT gen_random_uuid(), p_cabinet, v.code, v.libelle, v.admet
    FROM (VALUES
        ('client', 'client', FALSE),
        ('adversaire', 'adversaire', FALSE),
        ('demandeur', 'demandeur', FALSE),
        ('defendeur', 'défendeur', FALSE),
        ('intervenant_volontaire', 'intervenant volontaire', FALSE),
        ('intervenant_force', 'intervenant forcé', FALSE),
        ('appelant', 'appelant', FALSE),
        ('intime', 'intimé', FALSE),
        ('appele_jugement_commun', 'appelé en déclaration de jugement commun', FALSE),
        ('caution', 'caution', TRUE),
        ('assureur', 'assureur', TRUE),
        ('avocat', 'avocat', TRUE),
        ('avocat_plaidant', 'avocat plaidant', TRUE),
        ('avocat_postulant', 'avocat postulant', TRUE),
        ('commissaire_justice', 'commissaire de justice', TRUE),
        ('notaire', 'notaire', TRUE),
        ('expert_amiable', 'expert amiable', TRUE),
        ('expert_judiciaire', 'expert judiciaire', TRUE),
        ('administrateur_judiciaire', 'administrateur judiciaire', TRUE),
        ('mandataire_judiciaire', 'mandataire judiciaire', TRUE),
        ('liquidateur_judiciaire', 'liquidateur judiciaire', TRUE),
        ('commissaire_execution_plan', 'commissaire à l''exécution du plan', TRUE),
        ('curateur', 'curateur', TRUE),
        ('tuteur', 'tuteur', TRUE),
        ('representant_legal', 'représentant légal', TRUE),
        ('associe', 'associé', FALSE),
        ('apporteur_affaires', 'apporteur d''affaires', TRUE),
        ('autre', 'autre', TRUE)
    ) AS v(code, libelle, admet)
    ON CONFLICT (cabinet_id, code) DO NOTHING;
$$;

CREATE FUNCTION cabinets_qualites_apres_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM inserer_qualites_cabinet(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER cabinets_qualites
    AFTER INSERT ON cabinets
    FOR EACH ROW EXECUTE FUNCTION cabinets_qualites_apres_insert();

SELECT inserer_qualites_cabinet(id) FROM cabinets;

CREATE TABLE dossier_intervenants (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    dossier_id UUID NOT NULL REFERENCES dossiers (id) ON DELETE RESTRICT,
    contact_id UUID NOT NULL REFERENCES contacts (id) ON DELETE RESTRICT,
    qualite_id UUID NOT NULL REFERENCES qualites (id) ON DELETE RESTRICT,
    rattache_a UUID REFERENCES dossier_intervenants (id) ON DELETE RESTRICT,
    note TEXT,
    visibilite TEXT NOT NULL,
    groupe_acces UUID,
    revision BIGINT NOT NULL DEFAULT 1,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT dossier_intervenants_visibilite_check CHECK (visibilite IN ('public', 'restreint')),
    CONSTRAINT dossier_intervenants_pas_soi CHECK (rattache_a IS NULL OR rattache_a <> id)
);

CREATE INDEX dossier_intervenants_dossier_idx ON dossier_intervenants (dossier_id);
CREATE INDEX dossier_intervenants_contact_idx ON dossier_intervenants (contact_id);

CREATE TRIGGER dossier_intervenants_deduit_visibilite
    BEFORE INSERT OR UPDATE ON dossier_intervenants
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();

CREATE FUNCTION propager_visibilite_intervenants() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite
        OR NEW.groupe_acces IS DISTINCT FROM OLD.groupe_acces THEN
        UPDATE dossier_intervenants
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces
        WHERE dossier_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER dossiers_visibilite_intervenants
    AFTER UPDATE OF visibilite, groupe_acces ON dossiers
    FOR EACH ROW EXECUTE FUNCTION propager_visibilite_intervenants();
