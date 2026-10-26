-- Serveur de messagerie injoignable ou indisponible depuis plusieurs tentatives (consigne de l'architecte du
-- 26/10/2026) : un indicateur distinct de « identifiants_refuses ». Une panne du serveur (limite de connexions,
-- coupure, indisponibilité passagère) ne dit rien des identifiants : le moteur la retente avec un délai croissant, sans
-- jamais suspendre les tentatives, et l'écran dit « serveur indisponible ». Colonne ajoutée (la contrainte de
-- `etat_connexion` ne s'élargit pas : règle des migrations additives) ; le tableau de santé en tire l'état affiché.

ALTER TABLE comptes_mail ADD COLUMN serveur_indisponible BOOLEAN NOT NULL DEFAULT FALSE;
