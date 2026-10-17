-- J11 (iii) et (iv) : actions sur les messages d'une boîte et recherche serveur. Uniquement additif.
--
-- (iii) Les états qui redescendent vers le poste existent déjà (`messages.lu`, `drapeaux_texte`,
-- `dossier_imap`, déjà dans les cinq flux de messages) : aucune colonne synchronisée n'est
-- ajoutée. La file ci-dessous reste côté serveur, elle n'est pas synchronisée.
--
-- Une action (lu / non lu, archiver, supprimer, déplacer) est une ligne de la file. Elle est
-- appliquée au serveur IMAP puis seulement alors reflétée dans `messages` (même transaction que
-- le passage à « appliquee ») : le poste ne voit jamais un état que le serveur IMAP n'a pas
-- confirmé. « Supprimer » est un déplacement vers la Corbeille : aucun message n'est jamais
-- expurgé par cette file.
--
--   * `idempotence_cle` : choisie par l'appelant, unique par utilisateur. Le même appel rejoué
--     rend la même action ; la même clé avec d'autres paramètres est refusée (409).
--   * `rang` : ordre d'arrivée. Les actions d'un même message sont appliquées dans cet ordre.
--   * `reserve_jusqu_le` : bail posé quand une tâche prend l'action. Une tâche perdue (coupure de
--     l'API) libère l'action à l'échéance du bail, qui est alors reprise par le balayage.
--   * `erreur` : code technique (`connexion`, `authentification`, `protocole`, `compte`,
--     `message_absent`), jamais d'objet, d'adresse ni de nom de dossier. Une action en attente
--     garde le code de sa dernière tentative ; passée à « echec », elle ne sera plus reprise
--     (`message_absent` tout de suite, les autres codes après un nombre borné de tentatives).
--   * Aucune clé étrangère vers `messages` : la ligne d'un message peut disparaître à la relève
--     (message retiré du serveur) sans effacer la trace de l'action.
CREATE TABLE actions_messages (
    id UUID PRIMARY KEY,
    rang BIGINT GENERATED ALWAYS AS IDENTITY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    compte_id UUID NOT NULL REFERENCES comptes_mail (id) ON DELETE RESTRICT,
    message_ref UUID NOT NULL,
    message_id TEXT NOT NULL,
    genre TEXT NOT NULL,
    destination TEXT,
    idempotence_cle TEXT NOT NULL,
    etat TEXT NOT NULL DEFAULT 'en_attente',
    tentatives INTEGER NOT NULL DEFAULT 0,
    prochaine_tentative_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reserve_jusqu_le TIMESTAMPTZ,
    erreur TEXT,
    dossier_final TEXT,
    -- Position du message quand l'action a été prise en charge. La relève s'en sert pour ne pas
    -- ramener un message déplacé dans son ancien dossier avec une photographie du serveur plus
    -- ancienne que l'action (un UID n'est jamais réattribué dans une même UIDVALIDITY).
    dossier_source TEXT,
    uid_source BIGINT,
    uid_validity_source BIGINT,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applique_le TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 1,
    CONSTRAINT actions_messages_genre_check
        CHECK (genre IN ('lu', 'non_lu', 'archiver', 'supprimer', 'deplacer')),
    CONSTRAINT actions_messages_etat_check
        CHECK (etat IN ('en_attente', 'appliquee', 'echec')),
    CONSTRAINT actions_messages_destination_check
        CHECK ((genre = 'deplacer') = (destination IS NOT NULL)),
    CONSTRAINT actions_messages_cle_unique UNIQUE (utilisateur_id, idempotence_cle)
);

CREATE INDEX actions_messages_message_idx
    ON actions_messages (message_ref, rang) WHERE etat = 'en_attente';
CREATE INDEX actions_messages_dues_idx
    ON actions_messages (prochaine_tentative_le) WHERE etat = 'en_attente';
CREATE INDEX actions_messages_message_tous_idx ON actions_messages (message_ref);
CREATE INDEX actions_messages_utilisateur_idx
    ON actions_messages (utilisateur_id, rang);

-- (iv) Recherche serveur sur objet, expéditeur, destinataires et corps.
--
-- Le corps déjà stocké est `texte_brut` (corps complet, copié de `contenus_messages` à la première
-- lecture du message) et `extrait_texte` (début du corps, relevé avec l'en-tête pour tous les
-- messages). La recherche porte sur l'un et l'autre : un message jamais ouvert n'est trouvé que par
-- le début de son corps. Indexer le corps complet de tous les messages demande de le lire sur le
-- serveur IMAP (tâche de fond à décider avec l'architecte) ; ce n'est pas fait ici.
--
-- Le dictionnaire français ne replie ni les majuscules accentuées ni les accents dans une base en
-- locale C (`Évry` resterait `Évry`) : le texte indexé et la saisie passent par la même fonction de
-- repli. Les adresses sont coupées en mots (jean.dupont@exemple.fr → jean dupont exemple fr) pour
-- qu'un nom ou un domaine suffise.
--
-- Bornes : un tsvector ne dépasse pas 1 Mo ; le corps est tronqué à 100 000 caractères pour
-- l'index, ce qui laisse une marge à tout message réel sans jamais faire échouer l'écriture du
-- corps.
CREATE FUNCTION recherche_normaliser(p_texte TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT lower(translate(p_texte,
        'ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸàâäçéèêëîïôöùûüÿŒœ',
        'AAACEEEEIIOOUUUYaaaceeeeiioouuuyOo'))
$$;

ALTER TABLE messages ADD COLUMN recherche_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('french', recherche_normaliser(left(objet, 2000))), 'A')
    || setweight(to_tsvector('simple', recherche_normaliser(translate(
            left(expediteur || ' ' || destinataires_texte, 20000),
            '@._-<>,;"()[]/\+=:''', '                    '))), 'B')
    || setweight(to_tsvector('french', recherche_normaliser(
            left(extrait_texte, 2000) || ' ' || left(texte_brut, 100000))), 'C')
) STORED;

CREATE INDEX messages_recherche_idx ON messages USING GIN (recherche_tsv);

-- Requête tsquery de la recherche : les mots arrivent déjà nettoyés (lettres et chiffres,
-- `mot:*` reliés par « & »). Un texte que le moteur refuserait quand même ne fait jamais échouer
-- la recherche : repli sur plainto_tsquery, qui accepte n'importe quel texte.
CREATE FUNCTION requete_recherche_messages(p_texte TEXT) RETURNS tsquery
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN to_tsquery('french', recherche_normaliser(p_texte))
        || to_tsquery('simple', recherche_normaliser(p_texte));
EXCEPTION WHEN OTHERS THEN
    RETURN plainto_tsquery('french', recherche_normaliser(p_texte))
        || plainto_tsquery('simple', recherche_normaliser(p_texte));
END;
$$;
