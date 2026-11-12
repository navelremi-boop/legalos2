-- Notes de la fiche : auteur et date de modification, posés par le serveur à l'écriture.
-- Ajouts seulement. Une note déjà présente n'a pas d'auteur connu (auteur_id et auteur_libelle nuls).

ALTER TABLE contact_notes ADD COLUMN auteur_id UUID REFERENCES utilisateurs (id) ON DELETE SET NULL;
ALTER TABLE contact_notes ADD COLUMN auteur_libelle TEXT;
ALTER TABLE contact_notes ADD COLUMN modifie_le TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE contact_notes SET modifie_le = cree_le;
