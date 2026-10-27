-- Rôle administrateur minimal (dette « Avant J12 », décision de l'architecte du 14/10/2026) : deux rôles, `administrateur`
-- et `collaborateur`. Un administrateur crée les comptes du cabinet, tient les modèles de message, gère les membres des
-- boîtes partagées et, plus tard, les identifiants d'application OAuth. Colonne et contrainte ajoutées (additif) ; le
-- premier utilisateur de chaque cabinet (celui de l'installation) devient administrateur.

ALTER TABLE utilisateurs ADD COLUMN role TEXT NOT NULL DEFAULT 'collaborateur';
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_role_check
    CHECK (role IN ('administrateur', 'collaborateur'));

UPDATE utilisateurs
SET role = 'administrateur'
WHERE id IN (SELECT DISTINCT ON (cabinet_id) id FROM utilisateurs ORDER BY cabinet_id, cree_le, id);
