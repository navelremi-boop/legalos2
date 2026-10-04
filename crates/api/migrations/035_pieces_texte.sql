-- Noms de pièces jointes déjà lus dans BODYSTRUCTURE.

ALTER TABLE messages ADD COLUMN pieces_texte TEXT NOT NULL DEFAULT '';
