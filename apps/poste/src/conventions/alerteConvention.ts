/** Alerte « convention non signée » (B15, 28/10/2026). */

export const MOTIFS_LEVEE = [
  "urgence",
  "hors_application",
  "aide_juridictionnelle",
  "premier_rendez_vous",
  "dossier_interne",
] as const;

export type MotifLevee = (typeof MOTIFS_LEVEE)[number];

export type LeveeAlerte = {
  motif: MotifLevee;
  /** Jour civil de la levée, AAAA-MM-JJ. */
  le: string;
  /** Obligatoire pour une convention signée hors de l'application. */
  dateHorsApplication?: string;
};

const JOURS_URGENCE = 30;

function decaler(jour: string, jours: number): string {
  const [annee, mois, quantieme] = jour.split("-").map(Number);
  const date = new Date(Date.UTC(annee ?? 1970, (mois ?? 1) - 1, quantieme ?? 1));
  date.setUTCDate(date.getUTCDate() + jours);
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const q = String(date.getUTCDate()).padStart(2, "0");
  return `${String(date.getUTCFullYear())}-${m}-${q}`;
}

export function leveeValide(levee: LeveeAlerte): boolean {
  if (!MOTIFS_LEVEE.includes(levee.motif) || !/^\d{4}-\d{2}-\d{2}$/u.test(levee.le)) return false;
  if (levee.motif === "hors_application") {
    return typeof levee.dateHorsApplication === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(levee.dateHorsApplication);
  }
  return true;
}

/** Vrai tant qu'aucune convention n'est signée et que la levée, s'il y en a une, ne couvre plus le jour. */
export function alerteConventionActive(demande: {
  signee: boolean;
  levee: LeveeAlerte | null;
  aujourdhui: string;
}): boolean {
  if (demande.signee) return false;
  const levee = demande.levee;
  if (levee === null || !leveeValide(levee)) return true;
  if (levee.motif !== "urgence") return false;
  return demande.aujourdhui >= decaler(levee.le, JOURS_URGENCE);
}
