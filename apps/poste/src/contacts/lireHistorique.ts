import {
  mailsDuContact,
  regrouperDossiers,
  type DossierFiche,
  type FactureFiche,
  type MailBrut,
  type MailFiche,
  type NoteFiche,
} from "@/contacts/historiqueFiche";
import { getPowerSyncDatabase } from "@/sync/database";

type DossierLu = {
  id: string;
  nom: string;
  qualite: string;
  reference: string | null;
  chemise: string | null;
};

/**
 * Dossiers où intervient le contact, une ligne par dossier. Les droits sont ceux de la synchronisation :
 * un dossier restreint ne descend pas sur le poste de qui n'y a pas accès.
 */
export async function lireDossiersContact(contactId: string): Promise<DossierFiche[]> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<DossierLu>(
    `SELECT d.id AS id, d.nom AS nom, q.libelle AS qualite, d.reference AS reference, d.chemise AS chemise
     FROM dossier_intervenants i
     JOIN dossiers d ON d.id = i.dossier_id
     JOIN qualites q ON q.id = i.qualite_id
     WHERE i.contact_id = ?`,
    [contactId],
  );
  return regrouperDossiers(lignes);
}

/** Nombre de dossiers distincts par contact, pour le compteur de la liste. */
export async function compterDossiersParContact(): Promise<Map<string, number>> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<{ contact_id: string; n: number }>(
    `SELECT contact_id AS contact_id, COUNT(DISTINCT dossier_id) AS n
     FROM dossier_intervenants
     GROUP BY contact_id`,
  );
  const map = new Map<string, number>();
  for (const ligne of lignes) map.set(ligne.contact_id, ligne.n);
  return map;
}

type FactureLue = {
  id: string;
  numero: number | string | null;
  montant_ttc_centimes: number | null;
  statut: string | null;
  encaisse_centimes: number | null;
};

/**
 * Factures du client et somme des encaissements déjà synchronisés. La base locale n'a ni date ni objet de
 * facture : ces deux champs restent nuls et l'écran n'affiche alors pas ces colonnes.
 */
export async function lireFacturesContact(contactId: string): Promise<FactureFiche[]> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<FactureLue>(
    `SELECT f.id AS id, f.numero AS numero, f.montant_ttc_centimes AS montant_ttc_centimes, f.statut AS statut,
            COALESCE(SUM(e.montant_centimes), 0) AS encaisse_centimes
     FROM factures f
     LEFT JOIN facture_encaissements e ON e.facture_id = f.id
     WHERE f.contact_id = ?
     GROUP BY f.id, f.numero, f.montant_ttc_centimes, f.statut`,
    [contactId],
  );
  return lignes.map((ligne) => ({
    id: ligne.id,
    reference: ligne.numero === null || ligne.numero === "" ? null : String(ligne.numero),
    dateIso: null,
    objet: null,
    ttcCentimes: ligne.montant_ttc_centimes ?? 0,
    encaisseCentimes: ligne.encaisse_centimes ?? 0,
    brouillon: ligne.statut !== "validee",
  }));
}

type MailLu = {
  id: string;
  objet: string;
  expediteur: string;
  destinataires: string;
  etat: string;
  date_entete: string | null;
};

export async function lireMailsClasses(emails: readonly string[]): Promise<MailFiche[]> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<MailLu>(
    `SELECT id, objet, expediteur, destinataires_texte AS destinataires, etat_classement AS etat, date_entete
     FROM messages
     WHERE etat_classement = 'classe'`,
  );
  const comptes = await database.getAll<{ adresse: string | null }>(`SELECT adresse FROM comptes_mail`);
  const bruts: MailBrut[] = lignes.map((ligne) => ({
    id: ligne.id,
    objet: ligne.objet,
    expediteur: ligne.expediteur,
    destinataires: ligne.destinataires,
    etat: ligne.etat,
    dateIso: ligne.date_entete === null || ligne.date_entete.trim() === "" ? null : ligne.date_entete,
  }));
  return mailsDuContact(
    bruts,
    emails,
    comptes.map((compte) => compte.adresse ?? "").filter((adresse) => adresse !== ""),
  );
}

export async function lireNotesContact(contactId: string): Promise<NoteFiche[]> {
  const database = await getPowerSyncDatabase();
  return database.getAll<NoteFiche>(
    `SELECT id, texte FROM contact_notes WHERE contact_id = ? ORDER BY cree_le`,
    [contactId],
  );
}
