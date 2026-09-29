/**
 * Heure murale Europe/Paris, y compris le changement d'heure.
 * Un rendez-vous est un instant absolu dont l'heure affichée à Paris est celle choisie.
 */

function partsParis(instant: Date): { jour: string; heure: number; minute: number } {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const lire = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    jour: `${lire("year")}-${lire("month")}-${lire("day")}`,
    heure: Number(lire("hour")),
    minute: Number(lire("minute")),
  };
}

/** Instant ISO dont le mur à Paris est ce jour et cette heure. */
export function instantPourHeureParis(jour: string, heure: number, minute: number): string {
  const [annee, mois, quantieme] = jour.split("-").map(Number);
  let utc = Date.UTC(annee ?? 0, (mois ?? 1) - 1, quantieme ?? 1, heure, minute);
  for (let essai = 0; essai < 4; essai += 1) {
    const mur = partsParis(new Date(utc));
    const [aa, mm, jj] = mur.jour.split("-").map(Number);
    const deltaJour =
      Date.UTC(annee ?? 0, (mois ?? 1) - 1, quantieme ?? 1) -
      Date.UTC(aa ?? 0, (mm ?? 1) - 1, jj ?? 1);
    const deltaMinute = heure * 60 + minute - (mur.heure * 60 + mur.minute);
    const delta = deltaJour + deltaMinute * 60 * 1000;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc).toISOString();
}

/** Mur Europe/Paris d'un instant ISO. */
export function murParis(instantIso: string): { jour: string; heure: string; minute: string } {
  const mur = partsParis(new Date(instantIso));
  return {
    jour: mur.jour,
    heure: String(mur.heure).padStart(2, "0"),
    minute: String(mur.minute).padStart(2, "0"),
  };
}
