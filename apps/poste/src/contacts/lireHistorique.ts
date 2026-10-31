import { mailsDuContact, type DossierFiche, type FactureFiche, type MailFiche, type NoteFiche } from "@/contacts/historiqueFiche";
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
  encaisse_centimes: number | null;
};

/** Factures du client et somme des encaissements déjà synchronisés. */
export async function lireFacturesContact(contactId: string): Promise<FactureFiche[]> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<FactureLue>(
    `SELECT f.id AS id, f.numero AS numero, f.montant_ttc_centimes AS montant_ttc_centimes,
            COALESCE(SUM(e.montant_centimes), 0) AS encaisse_centimes
     FROM factures f
     LEFT JOIN facture_encaissements e ON e.facture_id = f.id
     WHERE f.contact_id = ?
     GROUP BY f.id, f.numero, f.montant_ttc_centimes
     ORDER BY f.numero COLLATE NOCASE`,
    [contactId],
  );
  return lignes.map((ligne) => ({
    id: ligne.id,
    libelle: ligne.numero ? `Facture ${ligne.numero}` : "Facture",
    ttcCentimes: ligne.montant_ttc_centimes ?? 0,
    encaisseCentimes: ligne.encaisse_centimes ?? 0,
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

export async function lireNotesContact(contactId: string): Promise<NoteFiche[]> {
  const database = await getPowerSyncDatabase();
  return database.getAll<NoteFiche>(
    `SELECT id, texte FROM contact_notes WHERE contact_id = ? ORDER BY cree_le`,
    [contactId],
  );
}
