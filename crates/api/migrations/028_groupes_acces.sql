-- Un bucket PowerSync par groupe d'accès, pas par dossier (PSYNC_S2305).
-- La visibilité et le groupe d'une ligne fille sont déduits du dossier par la base.

CREATE TABLE groupes_acces (
    id UUID PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    empreinte TEXT NOT NULL,
    CONSTRAINT groupes_acces_empreinte_unique UNIQUE (cabinet_id, empreinte)
);

CREATE TABLE groupe_acces_membres (
    groupe_id UUID NOT NULL REFERENCES groupes_acces (id) ON DELETE CASCADE,
    utilisateur_texte TEXT NOT NULL,
    PRIMARY KEY (groupe_id, utilisateur_texte)
);

CREATE INDEX groupe_acces_membres_utilisateur_idx
    ON groupe_acces_membres (utilisateur_texte);

ALTER TABLE dossiers ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);

ALTER TABLE parties ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE documents ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE document_versions ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE repertoires ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE temps_saisis ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE brouillons_facture ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE taux_horaires ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE intercalaires_personnalises ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE intercalaire_elements ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE intercalaire_elements ADD COLUMN cabinet_id UUID REFERENCES cabinets (id);
ALTER TABLE dossier_liens ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE agenda_elements ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE messages ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE journal_modifications ADD COLUMN groupe_acces UUID REFERENCES groupes_acces (id);
ALTER TABLE journal_modifications ADD COLUMN visibilite TEXT;

ALTER TABLE parties ALTER COLUMN visibilite DROP DEFAULT;
ALTER TABLE documents ALTER COLUMN visibilite DROP DEFAULT;
ALTER TABLE taux_horaires ALTER COLUMN visibilite DROP DEFAULT;

-- Groupe = ensemble exact des utilisateurs autorisés, partagé entre dossiers identiques.
CREATE FUNCTION assurer_groupe_acces(p_cabinet UUID, p_empreinte TEXT)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    gid UUID;
BEGIN
    SELECT id INTO gid
    FROM groupes_acces
    WHERE cabinet_id = p_cabinet AND empreinte = p_empreinte;
    IF gid IS NULL THEN
        gid := gen_random_uuid();
        INSERT INTO groupes_acces (id, cabinet_id, empreinte)
        VALUES (gid, p_cabinet, p_empreinte);
    END IF;
    DELETE FROM groupe_acces_membres WHERE groupe_id = gid;
    IF p_empreinte <> '' THEN
        INSERT INTO groupe_acces_membres (groupe_id, utilisateur_texte)
        SELECT gid, membre
        FROM unnest(string_to_array(p_empreinte, ',')) AS membre;
    END IF;
    RETURN gid;
END;
$$;

CREATE FUNCTION empreinte_ensemble(p_textes TEXT[])
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(string_agg(DISTINCT t, ',' ORDER BY t), '')
    FROM unnest(p_textes) AS t
    WHERE t IS NOT NULL AND t <> '';
$$;

CREATE FUNCTION recalculer_groupe_dossier(p_dossier UUID)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    cab UUID;
    est_restreint BOOLEAN;
    emp TEXT;
    gid UUID;
BEGIN
    SELECT cabinet_id, (visibilite = 'restreint')
    INTO cab, est_restreint
    FROM dossiers
    WHERE id = p_dossier;
    IF cab IS NULL THEN
        RETURN;
    END IF;
    IF NOT est_restreint THEN
        UPDATE dossiers SET groupe_acces = NULL
        WHERE id = p_dossier AND groupe_acces IS NOT NULL;
        RETURN;
    END IF;
    SELECT empreinte_ensemble(array_agg(utilisateur_texte))
    INTO emp
    FROM dossier_acces
    WHERE dossier_id = p_dossier;
    emp := coalesce(emp, '');
    gid := assurer_groupe_acces(cab, emp);
    UPDATE dossiers SET groupe_acces = gid
    WHERE id = p_dossier AND groupe_acces IS DISTINCT FROM gid;
END;
$$;

CREATE FUNCTION dossier_acces_recalcule_groupe()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM recalculer_groupe_dossier(COALESCE(NEW.dossier_id, OLD.dossier_id));
    RETURN NULL;
END;
$$;

CREATE TRIGGER dossier_acces_groupe
    AFTER INSERT OR UPDATE OR DELETE ON dossier_acces
    FOR EACH ROW
    EXECUTE FUNCTION dossier_acces_recalcule_groupe();

CREATE FUNCTION dossiers_visibilite_recalcule_groupe()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite THEN
        PERFORM recalculer_groupe_dossier(NEW.id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER dossiers_visibilite_groupe
    AFTER UPDATE OF visibilite ON dossiers
    FOR EACH ROW
    EXECUTE FUNCTION dossiers_visibilite_recalcule_groupe();

-- La fille ne choisit pas sa visibilité : elle est celle du dossier.
CREATE FUNCTION deduire_visibilite_fille()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_vis TEXT;
    v_groupe UUID;
    v_cab UUID;
    v_rest BOOLEAN;
BEGIN
    IF NEW.dossier_id IS NULL THEN
        NEW.visibilite := 'public';
        NEW.groupe_acces := NULL;
        IF TG_TABLE_NAME IN ('messages', 'intercalaires_personnalises', 'intercalaire_elements', 'agenda_elements') THEN
            NEW.restreint := FALSE;
        END IF;
        RETURN NEW;
    END IF;
    SELECT visibilite, groupe_acces, cabinet_id, restreint
    INTO v_vis, v_groupe, v_cab, v_rest
    FROM dossiers
    WHERE id = NEW.dossier_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'dossier introuvable pour la ligne fille';
    END IF;
    NEW.visibilite := v_vis;
    NEW.groupe_acces := v_groupe;
    IF TG_TABLE_NAME = 'intercalaire_elements' THEN
        NEW.cabinet_id := v_cab;
    END IF;
    IF TG_TABLE_NAME IN (
        'intercalaires_personnalises',
        'intercalaire_elements',
        'agenda_elements',
        'messages'
    ) THEN
        NEW.restreint := v_rest;
    END IF;
    IF TG_TABLE_NAME IN (
        'documents',
        'document_versions',
        'repertoires',
        'temps_saisis',
        'brouillons_facture',
        'taux_horaires'
    ) THEN
        NEW.dossier_texte := NEW.dossier_id::text;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER parties_deduit_visibilite
    BEFORE INSERT OR UPDATE ON parties
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER documents_deduit_visibilite
    BEFORE INSERT OR UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER document_versions_deduit_visibilite
    BEFORE INSERT OR UPDATE ON document_versions
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER repertoires_deduit_visibilite
    BEFORE INSERT OR UPDATE ON repertoires
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER temps_saisis_deduit_visibilite
    BEFORE INSERT OR UPDATE ON temps_saisis
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER brouillons_facture_deduit_visibilite
    BEFORE INSERT OR UPDATE ON brouillons_facture
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER taux_horaires_deduit_visibilite
    BEFORE INSERT OR UPDATE ON taux_horaires
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER intercalaires_deduit_visibilite
    BEFORE INSERT OR UPDATE ON intercalaires_personnalises
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER intercalaire_elements_deduit_visibilite
    BEFORE INSERT OR UPDATE ON intercalaire_elements
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER agenda_deduit_visibilite
    BEFORE INSERT OR UPDATE ON agenda_elements
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER messages_deduit_visibilite
    BEFORE INSERT OR UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();
CREATE TRIGGER journal_deduit_visibilite
    BEFORE INSERT OR UPDATE ON journal_modifications
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_fille();

-- Lien : groupe de la source, ou intersection si les deux dossiers sont restreints.
CREATE FUNCTION deduire_visibilite_lien()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    src_vis TEXT;
    src_groupe UUID;
    src_cab UUID;
    dst_vis TEXT;
    dst_id UUID;
    emp TEXT;
BEGIN
    SELECT visibilite, groupe_acces, cabinet_id
    INTO src_vis, src_groupe, src_cab
    FROM dossiers WHERE id = NEW.dossier_id;
    SELECT id, visibilite INTO dst_id, dst_vis
    FROM dossiers WHERE id = NEW.lie_a_id;
    NEW.cabinet_id := src_cab;
    NEW.lie_restreint := (dst_vis = 'restreint');
    IF src_vis = 'public' AND dst_vis = 'public' THEN
        NEW.visibilite := 'public';
        NEW.restreint := FALSE;
        NEW.groupe_acces := NULL;
        RETURN NEW;
    END IF;
    NEW.visibilite := 'restreint';
    NEW.restreint := TRUE;
    IF dst_vis = 'public' THEN
        NEW.groupe_acces := src_groupe;
        RETURN NEW;
    END IF;
    SELECT empreinte_ensemble(array_agg(utilisateur_texte))
    INTO emp
    FROM (
        SELECT utilisateur_texte FROM dossier_acces WHERE dossier_id = NEW.dossier_id
        INTERSECT
        SELECT utilisateur_texte FROM dossier_acces WHERE dossier_id = NEW.lie_a_id
    ) AS communs;
    NEW.groupe_acces := assurer_groupe_acces(src_cab, coalesce(emp, ''));
    RETURN NEW;
END;
$$;

CREATE TRIGGER dossier_liens_deduit_visibilite
    BEFORE INSERT OR UPDATE ON dossier_liens
    FOR EACH ROW EXECUTE FUNCTION deduire_visibilite_lien();

CREATE OR REPLACE FUNCTION propager_visibilite_documents() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibilite IS DISTINCT FROM OLD.visibilite
        OR NEW.groupe_acces IS DISTINCT FROM OLD.groupe_acces THEN
        UPDATE documents
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE document_versions
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE repertoires
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE parties
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces
        WHERE dossier_id = NEW.id;
        UPDATE temps_saisis
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE brouillons_facture
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE taux_horaires
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces, dossier_texte = NEW.id::text
        WHERE dossier_id = NEW.id;
        UPDATE intercalaires_personnalises
        SET visibilite = NEW.visibilite, restreint = NEW.restreint, groupe_acces = NEW.groupe_acces
        WHERE dossier_id = NEW.id;
        UPDATE intercalaire_elements
        SET visibilite = NEW.visibilite, restreint = NEW.restreint,
            groupe_acces = NEW.groupe_acces, cabinet_id = NEW.cabinet_id
        WHERE dossier_id = NEW.id;
        UPDATE agenda_elements
        SET visibilite = NEW.visibilite, restreint = NEW.restreint, groupe_acces = NEW.groupe_acces
        WHERE dossier_id = NEW.id;
        UPDATE messages
        SET visibilite = NEW.visibilite, restreint = (NEW.visibilite = 'restreint'),
            groupe_acces = NEW.groupe_acces
        WHERE dossier_id = NEW.id;
        UPDATE journal_modifications
        SET visibilite = NEW.visibilite, groupe_acces = NEW.groupe_acces
        WHERE dossier_id = NEW.id;
        UPDATE dossier_liens SET revision = revision + 1
        WHERE dossier_id = NEW.id OR lie_a_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER dossiers_visibilite_documents ON dossiers;
CREATE TRIGGER dossiers_visibilite_documents
    AFTER UPDATE OF visibilite, groupe_acces ON dossiers
    FOR EACH ROW
    EXECUTE FUNCTION propager_visibilite_documents();

-- Reprise de l'existant : le déclencheur BEFORE remplit visibilité, groupe et cabinet.
DO $$
DECLARE
    identifiant UUID;
BEGIN
    FOR identifiant IN SELECT id FROM dossiers LOOP
        PERFORM recalculer_groupe_dossier(identifiant);
    END LOOP;
END;
$$;

UPDATE journal_modifications SET id = id;
UPDATE intercalaire_elements SET id = id;

ALTER TABLE journal_modifications ALTER COLUMN visibilite SET NOT NULL;
ALTER TABLE intercalaire_elements ALTER COLUMN cabinet_id SET NOT NULL;

DELETE FROM groupes_acces AS groupe
WHERE NOT EXISTS (SELECT 1 FROM dossiers WHERE groupe_acces = groupe.id)
  AND NOT EXISTS (SELECT 1 FROM dossier_liens WHERE groupe_acces = groupe.id);
