-- Invitations reçues (J11, étape 2) : instant UTC, lien avec le message, boîte de réception,
-- réponse du titulaire. Uniquement additif ; les lignes de la migration 037 restent valides.
--
-- `debut` et `fin` gardent l'heure civile du fuseau annoncé (`2026-10-06T09:00:00`, ou
-- `2026-10-06` pour une journée entière). `debut_utc` et `fin_utc` en sont déduits à la relève
-- (`2026-10-06T07:00:00.000Z`) ; ils restent vides pour une heure flottante, une journée entière
-- ou un fuseau inconnu : aucun instant n'est inventé.

ALTER TABLE invitations_agenda ADD COLUMN debut_utc TEXT;
ALTER TABLE invitations_agenda ADD COLUMN fin_utc TEXT;

-- Message (en-tête Message-ID, comme `messages.message_id`) qui a créé ou mis à jour la ligne en
-- dernier : le poste relie ainsi la carte d'invitation au message sans deviner par l'objet.
ALTER TABLE invitations_agenda ADD COLUMN message_id TEXT;

-- Boîte nominative qui l'a reçue : la réponse part pour cette adresse. Non synchronisée.
ALTER TABLE invitations_agenda
    ADD COLUMN compte_id UUID REFERENCES comptes_mail (id) ON DELETE SET NULL;

-- Réponse du titulaire (`accepte`, `refuse`, `peut_etre`), et envoi de la file qui la porte.
-- Une SEQUENCE plus récente remet la réponse à vide : il faut répondre à la nouvelle version.
ALTER TABLE invitations_agenda ADD COLUMN reponse TEXT;
ALTER TABLE invitations_agenda ADD COLUMN repondu_le TIMESTAMPTZ;
ALTER TABLE invitations_agenda
    ADD COLUMN reponse_envoi_id UUID REFERENCES file_envoi (id) ON DELETE SET NULL;

ALTER TABLE invitations_agenda
    ADD CONSTRAINT invitations_agenda_reponse_check
    CHECK (reponse IS NULL OR reponse IN ('accepte', 'refuse', 'peut_etre'));
