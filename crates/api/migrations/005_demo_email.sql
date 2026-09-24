-- Renommage identifiant démo (état-major S2) : demo@cabinet-fictif.example
UPDATE utilisateurs
SET email = 'demo@cabinet-fictif.example'
WHERE id = '01950000-0000-7000-8000-000000000002'
  AND email = 'avocat.demo@cabinet-fictif.example';
