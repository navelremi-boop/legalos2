/**
 * Date d'un en-tête de mail convertie en instant, puis exprimée à l'heure de Paris.
 *
 * Trois écritures sont lues :
 * - RFC 2822 : « Tue, 14 Oct 2025 09:30:00 +0200 » (décalage numérique, ou nom d'usage : GMT, UT, Z, EST, CET…) ;
 * - ISO 8601 : « 2025-10-14T09:30:00Z », « 2025-10-14T09:30:00+02:00 » ;
 * - horodatage Postgres tel que la base locale le porte : « 2025-10-14 07:30:00+00 ».
 * Sans fuseau, la date est lue en UTC (jamais en heure locale du poste : le résultat ne dépend pas de la machine).
 * Une date illisible donne `null`, jamais une date inventée.
 */

const FUSEAU_PARIS = "Europe/Paris";

const MOIS_ANGLAIS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** Décalages (minutes) des noms de fuseau admis par la RFC 2822, plus ceux d'Europe centrale souvent rencontrés. */
const FUSEAUX_NOMMES: Readonly<Record<string, number>> = {
  Z: 0,
  UT: 0,
  UTC: 0,
  GMT: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  CET: 60,
  CEST: 120,
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/iu;
const RFC_2822 =
  /^(?:[A-Za-z]{3},?\s*)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,4})?\s*(?:\(.*\))?$/u;

/** Décalage en minutes d'un fuseau écrit « +0200 », « +02:00 », « +02 », « Z » ou « GMT » ; `null` s'il est illisible. */
function decalageMinutes(fuseau: string | undefined): number | null {
  if (fuseau === undefined || fuseau === "") return 0;
  const numerique = /^([+-])(\d{2})(?::?(\d{2}))?$/u.exec(fuseau);
  if (numerique !== null) {
    const heures = Number(numerique[2]);
    const minutes = Number(numerique[3] ?? "0");
    if (heures > 23 || minutes > 59) return null;
    return (numerique[1] === "-" ? -1 : 1) * (heures * 60 + minutes);
  }
  return FUSEAUX_NOMMES[fuseau.toUpperCase()] ?? null;
}

function instantDepuisChamps(
  annee: number,
  mois: number,
  jour: number,
  heure: number,
  minute: number,
  seconde: number,
  decalage: number,
): Date | null {
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31 || heure > 23 || minute > 59 || seconde > 60) return null;
  const mur = new Date(Date.UTC(annee, mois - 1, jour, heure, minute, Math.min(seconde, 59)));
  // Refuse un jour qui déborde (30 février) : la date reconstruite doit être celle qui a été écrite.
  if (mur.getUTCFullYear() !== annee || mur.getUTCMonth() !== mois - 1 || mur.getUTCDate() !== jour) return null;
  return new Date(mur.getTime() - decalage * 60_000);
}

/** Instant désigné par la date d'un en-tête ; `null` quand elle est absente ou illisible. */
export function instantDepuisEntete(entete: string | null | undefined): Date | null {
  const texte = (entete ?? "").trim();
  if (texte === "") return null;
  const iso = ISO.exec(texte);
  if (iso !== null) {
    const decalage = decalageMinutes(iso[7]);
    if (decalage === null) return null;
    return instantDepuisChamps(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4]),
      Number(iso[5]),
      Number(iso[6] ?? "0"),
      decalage,
    );
  }
  const rfc = RFC_2822.exec(texte);
  if (rfc === null) return null;
  const mois = MOIS_ANGLAIS.indexOf((rfc[2] ?? "").toLowerCase() as (typeof MOIS_ANGLAIS)[number]) + 1;
  if (mois === 0) return null;
  const anneeBrute = (rfc[3] ?? "").length;
  let annee = Number(rfc[3]);
  // RFC 2822, 4.3 : deux chiffres, 00 à 49 donnent 20xx, 50 à 99 donnent 19xx ; trois chiffres, 19xx.
  if (anneeBrute === 2) annee += annee < 50 ? 2000 : 1900;
  else if (anneeBrute === 3) annee += 1900;
  const fuseau = rfc[7];
  // Un nom de fuseau inconnu laisserait croire à un décalage nul : la date est alors refusée.
  const decalage = decalageMinutes(fuseau);
  if (decalage === null) return null;
  return instantDepuisChamps(
    annee,
    mois,
    Number(rfc[1]),
    Number(rfc[4]),
    Number(rfc[5]),
    Number(rfc[6] ?? "0"),
    decalage,
  );
}

export type DateHeureParis = {
  /** Jour civil de Paris, AAAA-MM-JJ. */
  jour: string;
  heure: number;
  minute: number;
};

const FORMAT_PARIS = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSEAU_PARIS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Jour et heure de Paris d'un instant, heure d'été comprise. */
export function enHeureDeParis(instant: Date): DateHeureParis {
  const parties = new Map(FORMAT_PARIS.formatToParts(instant).map((partie) => [partie.type, partie.value]));
  return {
    jour: `${parties.get("year") ?? ""}-${parties.get("month") ?? ""}-${parties.get("day") ?? ""}`,
    heure: Number(parties.get("hour") ?? "0") % 24,
    minute: Number(parties.get("minute") ?? "0"),
  };
}

/** Heure de Paris de la date d'un en-tête, ou `null` quand elle est absente ou illisible. */
export function heureDeParisDepuisEntete(entete: string | null | undefined): DateHeureParis | null {
  const instant = instantDepuisEntete(entete);
  return instant === null ? null : enHeureDeParis(instant);
}
