-- Début du corps, pour l'extrait de la liste. Le corps complet reste à part.

ALTER TABLE messages ADD COLUMN extrait_texte TEXT NOT NULL DEFAULT '';
