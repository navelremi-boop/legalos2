-- Destinataires déjà extraits des en-têtes, en texte pour la synchro.

ALTER TABLE messages ADD COLUMN destinataires_texte TEXT NOT NULL DEFAULT '';
