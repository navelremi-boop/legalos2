-- État de connexion visible du titulaire. Le secret refusé n'est pas synchronisé.

ALTER TABLE comptes_mail ADD COLUMN etat_connexion TEXT NOT NULL DEFAULT 'inconnu';
ALTER TABLE comptes_mail ADD COLUMN empreinte_refus TEXT;

ALTER TABLE comptes_mail ADD CONSTRAINT comptes_mail_etat_connexion_check
    CHECK (etat_connexion IN ('inconnu', 'connecte', 'identifiants_refuses'));

CREATE TABLE moteur_connexions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    compte_id UUID NOT NULL,
    issue TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT moteur_connexions_issue_check
        CHECK (issue IN ('connexion', 'authentification', 'ok'))
);

CREATE INDEX moteur_connexions_compte_idx ON moteur_connexions (compte_id, cree_le);
