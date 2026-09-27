-- Responsable du dossier (R0-b) et auteur des changements de modèle (R0-g).
-- Uniquement additif : colonnes NULL avec clé étrangère.

ALTER TABLE dossiers
    ADD COLUMN responsable_id UUID REFERENCES utilisateurs (id);

ALTER TABLE journal_modifications
    ADD COLUMN auteur_id UUID REFERENCES utilisateurs (id);
