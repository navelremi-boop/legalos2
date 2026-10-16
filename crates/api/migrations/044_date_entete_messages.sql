-- J11 (ii) : date d'en-tête (`Date:`) du message, distincte de la date d'arrivée (`cree_le`).
-- Uniquement additif. Instant UTC ; NULL quand l'en-tête est absent, illisible ou hors des bornes
-- raisonnables (voir `legalos_messagerie::date_entete`). Les messages existants restent NULL : le
-- poste retombe alors sur la date d'arrivée.
ALTER TABLE messages ADD COLUMN date_entete TIMESTAMPTZ;
