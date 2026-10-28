import { alerteConventionActive, type LeveeAlerte, type MotifLevee } from "@/conventions/alerteConvention";
import { getPowerSyncDatabase } from "@/sync/database";

export const MODES_CONVENTION = ["temps", "forfait", "resultat"] as const;
export type ModeConvention = (typeof MODES_CONVENTION)[number];
export const STATUTS_CONVENTION = ["brouillon", "envoyee", "signee"] as const;
export type StatutConvention = (typeof STATUTS_CONVENTION)[number];

export type ConventionDossier = {
  id: string;
  dossierId: string;
  statut: StatutConvention;
  mode: ModeConvention;
  documentId: string | null;
  signeNom: string | null;
  motifLevee: MotifLevee | null;
  leveeLe: string | null;
  dateHorsApplication: string | null;
};

const DDL = `CREATE TABLE IF NOT EXISTS conventions_honoraires (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL,
  statut TEXT NOT NULL,
  mode TEXT NOT NULL,
  document_id TEXT,
  signe_nom TEXT,
  motif_levee TEXT,
  levee_le TEXT,
  date_hors_application TEXT,
  cree_le TEXT NOT NULL
)`;

type Ligne = {
  id: string;
  dossier_id: string;
  statut: string;
  mode: string;
  document_id: string | null;
  signe_nom: string | null;
  motif_levee: string | null;
  levee_le: string | null;
  date_hors_application: string | null;
};

function estStatut(valeur: string): valeur is StatutConvention {
  return (STATUTS_CONVENTION as readonly string[]).includes(valeur);
}

function estMode(valeur: string): valeur is ModeConvention {
  return (MODES_CONVENTION as readonly string[]).includes(valeur);
}

function estMotif(valeur: string | null): valeur is MotifLevee | null {
  return (
    valeur === null ||
    valeur === "urgence" ||
    valeur === "hors_application" ||
    valeur === "aide_juridictionnelle" ||
    valeur === "premier_rendez_vous" ||
    valeur === "dossier_interne"
  );
}

async function base() {
  const database = await getPowerSyncDatabase();
  await database.execute(DDL);
  return database;
}

function versConvention(ligne: Ligne): ConventionDossier | null {
  if (!estStatut(ligne.statut) || !estMode(ligne.mode) || !estMotif(ligne.motif_levee)) return null;
  return {
    id: ligne.id,
    dossierId: ligne.dossier_id,
    statut: ligne.statut,
    mode: ligne.mode,
    documentId: ligne.document_id,
    signeNom: ligne.signe_nom,
    motifLevee: ligne.motif_levee,
    leveeLe: ligne.levee_le,
    dateHorsApplication: ligne.date_hors_application,
  };
}

export async function lireConventions(dossierId: string): Promise<ConventionDossier[]> {
  const database = await base();
  const lignes = await database.getAll<Ligne>(
    "SELECT id, dossier_id, statut, mode, document_id, signe_nom, motif_levee, levee_le, date_hors_application FROM conventions_honoraires WHERE dossier_id = ? ORDER BY cree_le",
    [dossierId],
  );
  return lignes.flatMap((ligne) => {
    const convention = versConvention(ligne);
    return convention ? [convention] : [];
  });
}

export function alerteDuDossier(conventions: readonly ConventionDossier[], aujourdhui: string): boolean {
  if (conventions.some((convention) => convention.statut === "signee")) return false;
  const levee = conventions.find((convention) => convention.motifLevee && convention.leveeLe);
  const leveeAlerte: LeveeAlerte | null =
    levee?.motifLevee && levee.leveeLe
      ? {
          motif: levee.motifLevee,
          le: levee.leveeLe,
          dateHorsApplication: levee.dateHorsApplication ?? undefined,
        }
      : null;
  return alerteConventionActive({ signee: false, levee: leveeAlerte, aujourdhui });
}

export async function creerConvention(dossierId: string, mode: ModeConvention, documentId: string): Promise<string> {
  const database = await base();
  const id = crypto.randomUUID();
  await database.execute(
    `INSERT INTO conventions_honoraires (id, dossier_id, statut, mode, document_id, cree_le)
     VALUES (?, ?, 'brouillon', ?, ?, ?)`,
    [id, dossierId, mode, documentId, new Date().toISOString()],
  );
  return id;
}

export async function marquerEnvoyee(id: string): Promise<void> {
  const database = await base();
  await database.execute(
    "UPDATE conventions_honoraires SET statut = 'envoyee' WHERE id = ? AND statut = 'brouillon'",
    [id],
  );
}

export async function deposerSigne(id: string, nom: string): Promise<void> {
  const database = await base();
  await database.execute(
    "UPDATE conventions_honoraires SET statut = 'signee', signe_nom = ? WHERE id = ? AND statut = 'envoyee'",
    [nom, id],
  );
}

export async function leverAlerte(
  dossierId: string,
  motif: MotifLevee,
  le: string,
  dateHorsApplication: string | null,
): Promise<void> {
  const database = await base();
  const id = crypto.randomUUID();
  await database.execute(
    `INSERT INTO conventions_honoraires (
       id, dossier_id, statut, mode, motif_levee, levee_le, date_hors_application, cree_le
     ) VALUES (?, ?, 'brouillon', 'temps', ?, ?, ?, ?)`,
    [id, dossierId, motif, le, dateHorsApplication, new Date().toISOString()],
  );
}
