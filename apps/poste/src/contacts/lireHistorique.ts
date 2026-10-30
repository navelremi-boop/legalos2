import { mailsDuContact, type DossierFiche, type FactureFiche, type MailFiche } from "@/contacts/historiqueFiche";
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

type FactureLue = {
  id: string;
  numero: string | null;
  montant_ttc_centimes: number | null;
};

/** Factures du client déjà synchronisées. L'encaissé viendra avec les règlements. */
export async function lireFacturesContact(contactId: string): Promise<FactureFiche[]> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<FactureLue>(
    `SELECT id, numero, montant_ttc_centimes
     FROM factures
     WHERE contact_id = ?
     ORDER BY numero COLLATE NOCASE`,
    [contactId],
  );
  return lignes.map((ligne) => ({
    id: ligne.id,
    libelle: ligne.numero ? `Facture ${ligne.numero}` : "Facture",
    ttcCentimes: ligne.montant_ttc_centimes ?? 0,
    encaisseCentimes: 0,
  }));
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
