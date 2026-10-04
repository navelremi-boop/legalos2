import { fr } from "@/lib/fr";

const NBSP = "\u00a0";

/**
 * Durée française (§ 7.7) : « 0 h 12 », « 1 h 30 ».
 * Les secondes ne sont pas affichées (formateur maison, pas Intl).
 */
export function formatDuree(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const heures = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return fr(`${String(heures)}${NBSP}h${NBSP}${String(minutes)}`);
}

/**
 * Heure française (§ 7.7) : « 9 h 12 » (pas « 09:12 »).
 */
export function formatHeure(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  return fr(`${String(h)}${NBSP}h${NBSP}${String(m).padStart(2, "0")}`);
}

const MOIS_COURT = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
] as const;

const MOIS_LONG = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

const JOURS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

type DateCivile = { annee: number; mois: number; jour: number };

/** Jour civil AAAA-MM-JJ, sans décalage de fuseau. */
export function dateCivile(iso: string): DateCivile | null {
  const trouve = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!trouve) return null;
  const annee = Number(trouve[1]);
  const mois = Number(trouve[2]);
  const jour = Number(trouve[3]);
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || !Number.isInteger(jour)) return null;
  const utc = new Date(Date.UTC(annee, mois - 1, jour));
  if (utc.getUTCFullYear() !== annee || utc.getUTCMonth() !== mois - 1 || utc.getUTCDate() !== jour) {
    return null;
  }
  return { annee, mois, jour };
}

/** Le 1er du mois s'écrit « 1er », pas « 1 ». */
function quantieme(jour: number): string {
  return jour === 1 ? "1er" : String(jour);
}

/**
 * Date courte (§ 7.7) : « 30 sept. », « 1er oct. ».
 */
export function formatDateCourte(iso: string): string {
  const date = dateCivile(iso);
  if (!date) return "";
  const mois = MOIS_COURT[date.mois - 1];
  if (mois === undefined) return "";
  return fr(`${quantieme(date.jour)} ${mois}`);
}

/**
 * Date longue (§ 7.7) : « mardi 30 septembre », « jeudi 1er octobre ».
 */
export function formatDateLongue(iso: string): string {
  const date = dateCivile(iso);
  if (!date) return "";
  const mois = MOIS_LONG[date.mois - 1];
  const nom = JOURS[new Date(Date.UTC(date.annee, date.mois - 1, date.jour)).getUTCDay()];
  if (mois === undefined || nom === undefined) return "";
  return fr(`${nom} ${quantieme(date.jour)} ${mois}`);
}

/**
 * Heure française à partir de chiffres déjà muraux : « 9 h 12 ».
 */
export function formatHeureMur(heure: number, minute: number): string {
  return fr(`${String(heure)}${NBSP}h${NBSP}${String(minute).padStart(2, "0")}`);
}

/**
 * Montant français (§ 7.7) : « 2 400,00 € ».
 */
export function formatMontant(centimes: number): string {
  const euros = centimes / 100;
  const formate = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(euros);
  return fr(formate);
}
