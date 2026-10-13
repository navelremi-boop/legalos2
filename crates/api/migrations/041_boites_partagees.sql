-- J11 étape 3 : boîtes partagées (membres), droit de lecture d'un compte, repère d'arrivée pour
-- la notification de bureau. Uniquement additif.
--
-- Règles de lecture (cahier § 3.8, « cloisonnement des boîtes mail ») :
--   * boîte nominative : son titulaire seul ;
--   * boîte partagée : ses membres seuls (`membres_boite_partagee`) ;
--   * boîte de classement : tout le cabinet ;
--   * un mail classé dans un dossier suit les droits de ce dossier (flux messages_publics et
--     messages_restreints), jamais ceux de la boîte d'où il vient.

CREATE TABLE membres_boite_partagee (
    compte_id UUID NOT NULL REFERENCES comptes_mail (id) ON DELETE CASCADE,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    -- Texte de l'identifiant : un flux PowerSync compare `auth.user_id()` (texte) à une colonne.
    -- Colonne ordinaire remplie par la base : la réplication logique de Postgres ne publie pas les
    -- colonnes générées, PowerSync ne la verrait pas.
    utilisateur_texte TEXT NOT NULL DEFAULT '',
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (compte_id, utilisateur_id)
);

CREATE FUNCTION completer_membre_boite_partagee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.utilisateur_texte := NEW.utilisateur_id::text;
    RETURN NEW;
END;
$$;

CREATE TRIGGER membres_boite_partagee_texte
    BEFORE INSERT OR UPDATE ON membres_boite_partagee
    FOR EACH ROW
    EXECUTE FUNCTION completer_membre_boite_partagee();

CREATE INDEX membres_boite_partagee_utilisateur_idx
    ON membres_boite_partagee (utilisateur_id);

-- Un compte est-il lisible par cet utilisateur ? Source unique des routes de l'API.
CREATE FUNCTION compte_mail_lisible_par(p_compte UUID, p_utilisateur UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT CASE c.type_compte
        WHEN 'nominatif' THEN c.titulaire_id = p_utilisateur
        WHEN 'partage' THEN EXISTS (
            SELECT 1 FROM membres_boite_partagee b
            WHERE b.compte_id = c.id AND b.utilisateur_id = p_utilisateur
        )
        ELSE TRUE
    END
    FROM comptes_mail c
    WHERE c.id = p_compte
$$;

-- Un message est-il lisible par cet utilisateur ? Boîte nominative : son titulaire (même si le
-- mail est classé ailleurs : c'est sa boîte). Boîte partagée ou de classement : la boîte doit être
-- lisible et, si le mail est classé, le dossier aussi (un dossier restreint reste fermé).
CREATE FUNCTION message_lisible_par(p_compte UUID, p_dossier UUID, p_utilisateur UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT CASE c.type_compte
        WHEN 'nominatif' THEN c.titulaire_id = p_utilisateur
        ELSE compte_mail_lisible_par(c.id, p_utilisateur)
            AND (
                p_dossier IS NULL
                OR EXISTS (
                    SELECT 1 FROM dossiers d
                    WHERE d.id = p_dossier
                      AND d.cabinet_id = c.cabinet_id
                      AND (
                        d.restreint = FALSE
                        OR EXISTS (
                            SELECT 1 FROM dossier_acces a
                            WHERE a.dossier_id = d.id AND a.utilisateur_id = p_utilisateur
                        )
                      )
                )
            )
    END
    FROM comptes_mail c
    WHERE c.id = p_compte
$$;

-- Les messages d'une boîte partagée ne passent pas par « À classer » du cabinet : seuls ses
-- membres les reçoivent (flux messages_boites_partagees).
ALTER TABLE messages ADD COLUMN boite_partagee BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE messages
SET boite_partagee = TRUE
WHERE compte_id IN (SELECT id FROM comptes_mail WHERE type_compte = 'partage');

CREATE OR REPLACE FUNCTION completer_titulaire_message() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    SELECT titulaire_id, (type_compte = 'partage')
    INTO NEW.titulaire_id, NEW.boite_partagee
    FROM comptes_mail
    WHERE id = NEW.compte_id;
    RETURN NEW;
END;
$$;

-- Arrivée d'un message, pour la notification de bureau du poste.
--   * `arrivee_seq` : rang d'insertion, croissant, jamais modifié ensuite. Le poste garde le plus
--     grand rang déjà traité (horloge du poste et du serveur non comparées).
--   * `arrivee_notifiable` : vrai seulement pour un message arrivé dans la réception d'une boîte
--     déjà relevée (jamais pour la première relève, ni après un changement de UIDVALIDITY :
--     c'est de l'historique, pas une arrivée), et encore non lu à l'arrivée.
CREATE SEQUENCE messages_arrivee_seq;
ALTER TABLE messages ADD COLUMN arrivee_seq BIGINT NOT NULL DEFAULT nextval('messages_arrivee_seq');
ALTER TABLE messages ADD COLUMN arrivee_notifiable BOOLEAN NOT NULL DEFAULT FALSE;
