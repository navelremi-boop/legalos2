import type { CommonPowerSyncDatabase } from "@powersync/common";
import type { InvitationLocale } from "@/messagerie/typesMails";

/**
 * Invitations reçues, lues dans la base locale (aucun appel réseau). La table `invitations_agenda` n'est alimentée que
 * par le flux « invitations du titulaire » : seules celles de l'utilisateur connecté y descendent.
 */
export async function lireInvitations(database: CommonPowerSyncDatabase): Promise<InvitationLocale[]> {
  return database.getAll<InvitationLocale>(
    `SELECT id, uid_ical, sequence, effet, fuseau, debut, fin, debut_utc, fin_utc, objet, organisateur,
            verifiee, message_id, reponse
     FROM invitations_agenda ORDER BY debut`,
  );
}
