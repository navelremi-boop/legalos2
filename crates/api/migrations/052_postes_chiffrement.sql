-- Chiffrement du disque non détecté : le poste est inscrit, le travail n'est pas bloqué.
ALTER TABLE postes
    ADD COLUMN chiffrement_disque TEXT NOT NULL DEFAULT 'non_confirme';
