-- Identité des membres du cabinet. Ajouts seulement.
-- Aucune valeur n'est déduite de l'adresse e-mail : les colonnes restent NULL tant qu'elles ne sont pas saisies.

ALTER TABLE utilisateurs ADD COLUMN civilite TEXT;
ALTER TABLE utilisateurs ADD COLUMN prenom TEXT;
ALTER TABLE utilisateurs ADD COLUMN nom TEXT;
ALTER TABLE utilisateurs ADD COLUMN qualite TEXT;
ALTER TABLE utilisateurs ADD COLUMN barreau TEXT;
ALTER TABLE utilisateurs ADD COLUMN toque TEXT;
ALTER TABLE utilisateurs ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_civilite_check
    CHECK (civilite IS NULL OR civilite IN ('madame', 'monsieur'));
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_qualite_check
    CHECK (qualite IS NULL OR qualite IN ('avocat', 'avocat_collaborateur', 'juriste', 'assistant', 'autre'));
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_identite_texte_check
    CHECK (
        (prenom IS NULL OR (prenom = btrim(prenom) AND length(prenom) BETWEEN 1 AND 100))
        AND (nom IS NULL OR (nom = btrim(nom) AND length(nom) BETWEEN 1 AND 100))
        AND (barreau IS NULL OR (barreau = btrim(barreau) AND length(barreau) BETWEEN 1 AND 100))
        AND (toque IS NULL OR (toque = btrim(toque) AND length(toque) BETWEEN 1 AND 20))
    );
-- Barreau et toque : avocats seulement.
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_barreau_toque_check
    CHECK ((barreau IS NULL AND toque IS NULL) OR COALESCE(qualite IN ('avocat', 'avocat_collaborateur'), FALSE));
