-- Situation familiale d'une personne physique. Ajout seulement.

ALTER TABLE contacts ADD COLUMN situation_familiale TEXT;

ALTER TABLE contacts ADD CONSTRAINT contacts_situation_familiale_check
    CHECK (
        situation_familiale IS NULL
        OR situation_familiale IN ('celibataire', 'marie', 'pacse', 'divorce', 'veuf')
    );
