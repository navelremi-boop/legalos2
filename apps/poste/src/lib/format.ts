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
