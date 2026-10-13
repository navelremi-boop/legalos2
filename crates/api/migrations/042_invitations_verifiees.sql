-- Invitations reçues (J11, étape 2, correctif) : origine vérifiée ou non.
--
-- Une invitation est « vérifiée » quand le mail qui la porte (`From` ou `Sender`) vient de
-- l'`ORGANIZER` annoncé. Une mise à jour ou une annulation n'est appliquée que si le mail vient de
-- l'organisateur enregistré pour ce UID ; l'`ORGANIZER` ne change jamais. Les lignes déjà
-- présentes ont été créées sans ce contrôle : elles sont marquées non vérifiées.
ALTER TABLE invitations_agenda ADD COLUMN verifiee BOOLEAN NOT NULL DEFAULT FALSE;
