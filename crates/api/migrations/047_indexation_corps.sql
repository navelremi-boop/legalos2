-- Indexation de fond du corps de tous les messages (J11, consigne de l'architecte du 20/10/2026). Uniquement additif.
--
-- Pourquoi des tables à part et non des colonnes de `messages` : `messages` est répliquée vers PowerSync. Toute
-- écriture dans une ligne (même d'une colonne qui ne descend pas vers les postes) ajoute une opération au seau de
-- chaque utilisateur concerné ; indexer 100 000 messages en ajouterait 100 000, que la compaction ne retire pas (le
-- 17/10, 500 000 opérations ont suffi à bloquer la synchronisation initiale d'un poste). Ces tables ne sont dans
-- aucune règle de synchronisation : le corps indexé ne quitte jamais le serveur.
--
--   * `messages_corps_index` : une ligne par message indexé. `tsv` est le vecteur complet du message : celui de
--     l'en-tête (`messages.recherche_tsv`, migration 045) augmenté du corps (100 000 premiers caractères). La
--     recherche utilise `tsv` pour les messages indexés et `messages.recherche_tsv` pour les autres, sans jamais
--     perdre un mot réparti entre l'objet et le corps.
--   * `messages_corps_echecs` : lecture impossible (message retiré, serveur muet, texte refusé par l'index). Au
--     troisième échec le message est abandonné et compté à l'écran de santé ; avant, il est retenté plus tard.
--
-- Aucune clé étrangère vers `comptes_mail` : la ligne suit celle du message (suppression en cascade).

CREATE TABLE messages_corps_index (
    message_ref UUID PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    compte_id UUID NOT NULL,
    tsv tsvector NOT NULL,
    indexe_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX messages_corps_index_tsv_idx ON messages_corps_index USING GIN (tsv);
CREATE INDEX messages_corps_index_compte_idx ON messages_corps_index (compte_id);

CREATE TABLE messages_corps_echecs (
    message_ref UUID PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
    compte_id UUID NOT NULL,
    tentatives INTEGER NOT NULL DEFAULT 1,
    -- Code technique (`absent`, `connexion`, `texte`, `uidvalidity`), jamais d'objet, d'adresse ni de contenu.
    erreur TEXT NOT NULL,
    prochaine_le TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);
CREATE INDEX messages_corps_echecs_compte_idx ON messages_corps_echecs (compte_id);
