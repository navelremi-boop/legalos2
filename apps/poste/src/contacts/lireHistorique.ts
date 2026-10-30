import { mailsDuContact, type DossierFiche, type MailFiche } from "@/contacts/historiqueFiche";
import { getPowerSyncDatabase } from "@/sync/database";

export async function lireDossiersContact(contactId: string): Promise<DossierFiche[]> {
  const database = await getPowerSyncDatabase();
  return database.getAll<DossierFiche>(
    `SELECT d.id AS id, d.nom AS nom, q.libelle AS qualite
     FROM dossier_intervenants i
     JOIN dossiers d ON d.id = i.dossier_id
     JOIN qualites q ON q.id = i.qualite_id
     WHERE i.contact_id = ?
     ORDER BY d.nom COLLATE NOCASE`,
    [contactId],
  );
}

export async function lireMailsClasses(emails: readonly string[]): Promise<MailFiche[]> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<MailFiche>(
    `SELECT id, objet, expediteur, destinataires_texte AS destinataires, etat_classement AS etat
     FROM messages
     WHERE etat_classement = 'classe'`,
  );
  return mailsDuContact(lignes, emails);
}
