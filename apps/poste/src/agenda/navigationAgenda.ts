/**
 * Repères de l'écran Agenda : jours civils (AAAA-MM-JJ) et semaines commençant le lundi. Calcul sur le calendrier
 * civil, sans fuseau : un jour décalé reste le même jour à Paris comme ailleurs.
 */

/** Jour civil d'une date, d'après l'heure locale de la machine. */
export function jourCivil(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${mois}-${jour}`;
}

function enUtc(jour: string): Date {
  const [annee, mois, quantieme] = jour.split("-").map(Number);
  return new Date(Date.UTC(annee ?? 1970, (mois ?? 1) - 1, quantieme ?? 1));
}

function versJour(date: Date): string {
  const mois = String(date.getUTCMonth() + 1).padStart(2, "0");
  const quantieme = String(date.getUTCDate()).padStart(2, "0");
  return `${String(date.getUTCFullYear())}-${mois}-${quantieme}`;
}

/** Le jour décalé de `n` jours (négatif : avant). */
export function decalerJour(jour: string, n: number): string {
  const date = enUtc(jour);
  date.setUTCDate(date.getUTCDate() + n);
  return versJour(date);
}

/** Les sept jours de la semaine (lundi au dimanche) qui contient `jour`. */
export function semaineDe(jour: string): string[] {
  const decalage = (enUtc(jour).getUTCDay() + 6) % 7;
  const lundi = decalerJour(jour, -decalage);
  return Array.from({ length: 7 }, (_, index) => decalerJour(lundi, index));
}
