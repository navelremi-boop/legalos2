import type { CommonPowerSyncDatabase } from "@powersync/common";
import { lireInvitations } from "@/agenda/donneesInvitations";
import { listerBrouillons } from "@/messagerie/brouillons";
import type { LigneBrouillon } from "@/messagerie/etatRedaction";
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
  /** Brouillons de l'utilisateur (table `brouillons_message`). */
  brouillons: LigneBrouillon[];
};

export async function lireDonneesMails(database: CommonPowerSyncDatabase): Promise<DonneesMails> {
  const [comptes, mails, dossiers, invitations, brouillons] = await Promise.all([
    database.getAll<CompteLocal>(
      "SELECT id, adresse, type_compte, titulaire_id FROM comptes_mail ORDER BY adresse",
    ),
    database.getAll<MailLocal>(
      `SELECT id, message_id, objet, expediteur, destinataires_texte, pieces_texte, extrait_texte,
              substr(texte_brut, 1, 240) AS debut_texte, etat_classement, dossier_id,
              suggestion_dossier_id, titulaire_id, lu, dossier_imap, date_entete, cree_le
       FROM messages ORDER BY COALESCE(date_entete, cree_le) DESC`,
    ),
    database.getAll<DossierLocal>("SELECT id, nom, chemise, reference FROM dossiers"),
    lireInvitations(database),
    listerBrouillons(database),
  ]);
  return { comptes, mails, dossiers, invitations, brouillons };
}

/** Corps nettoyé d'un message stocké sur le poste ; chaîne vide s'il n'y est pas. */
export async function lireTexteStocke(database: CommonPowerSyncDatabase, id: string): Promise<string> {
  const lignes = await database.getAll<{ texte_brut: string | null }>(
    "SELECT texte_brut FROM messages WHERE id = ?",
    [id],
  );
  return lignes[0]?.texte_brut ?? "";
}
