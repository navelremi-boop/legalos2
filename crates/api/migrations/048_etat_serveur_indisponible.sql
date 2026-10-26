-- Serveur de messagerie injoignable ou indisponible depuis plusieurs tentatives (consigne de l'architecte du
-- 26/10/2026) : un nouvel état de connexion, distinct de « identifiants_refuses ». Une panne du serveur (limite de
-- connexions, coupure, indisponibilité passagère) ne dit rien des identifiants : le moteur la retente avec un délai
-- croissant, sans jamais suspendre les tentatives, et l'écran dit « serveur indisponible ».

ALTER TABLE comptes_mail DROP CONSTRAINT comptes_mail_etat_connexion_check;
ALTER TABLE comptes_mail ADD CONSTRAINT comptes_mail_etat_connexion_check
    CHECK (etat_connexion IN ('inconnu', 'connecte', 'identifiants_refuses', 'indisponible'));
