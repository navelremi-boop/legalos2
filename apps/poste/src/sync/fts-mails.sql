-- Recherche hors ligne des mails synchronisés (FTS5). Le texte indexé est déjà nettoyé.
CREATE VIRTUAL TABLE IF NOT EXISTS mails_fts USING fts5(
  message_id UNINDEXED,
  texte
);
