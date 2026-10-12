import type { CommonPowerSyncDatabase } from "@powersync/common";
import type { CompteLocal, DossierLocal, InvitationLocale, MailLocal } from "@/messagerie/typesMails";

/**
 * Lectures de la base locale pour l'écran Mails (aucun appel réseau). Le corps entier des messages n'est
 * pas chargé avec la liste : un début de texte suffit à l'aperçu, le corps se lit à la demande.
 */

export type DonneesMails = {
  comptes: CompteLocal[];
  mails: MailLocal[];
  dossiers: DossierLocal[];
  invitations: InvitationLocale[];
};

export async function lireDonneesMails(database: CommonPowerSyncDatabase): Promise<DonneesMails> {
  const [comptes, mails, dossiers, invitations] = await Promise.all([
    database.getAll<CompteLocal>(
      "SELECT id, adresse, type_compte, titulaire_id, etat_connexion FROM comptes_mail ORDER BY adresse",
    ),
    database.getAll<MailLocal>(
      `SELECT id, message_id, objet, expediteur, destinataires_texte, pieces_texte, extrait_texte,
              substr(texte_brut, 1, 240) AS debut_texte, etat_classement, dossier_id,
              suggestion_dossier_id, titulaire_id, lu, dossier_imap, cree_le
       FROM messages ORDER BY cree_le DESC`,
    ),
    database.getAll<DossierLocal>("SELECT id, nom, chemise, reference FROM dossiers"),
    database.getAll<InvitationLocale>(
      `SELECT id, uid_ical, sequence, effet, fuseau, debut, fin, objet, organisateur
       FROM invitations_agenda ORDER BY debut`,
    ),
  ]);
  return { comptes, mails, dossiers, invitations };
}

/** Corps nettoyé d'un message stocké sur le poste ; chaîne vide s'il n'y est pas. */
export async function lireTexteStocke(database: CommonPowerSyncDatabase, id: string): Promise<string> {
  const lignes = await database.getAll<{ texte_brut: string | null }>(
    "SELECT texte_brut FROM messages WHERE id = ?",
    [id],
  );
  return lignes[0]?.texte_brut ?? "";
}
