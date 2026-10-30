/** Montants saisis en unités (10 000,50) et stockés en centimes. */
export const MONNAIES = ["EUR", "CHF", "USD", "GBP"] as const;

export type Monnaie = (typeof MONNAIES)[number];

export function estMonnaie(valeur: string): valeur is Monnaie {
  return (MONNAIES as readonly string[]).includes(valeur);
}

/** Vide : pas de capital. Refuse un montant négatif ou plus de deux décimales. */
export function centimesDepuisSaisie(saisie: string): number | null {
  const net = saisie.replace(/[\s\u00a0\u202f]/g, "");
  if (net === "") return null;
  if (!/^\d+(,\d{1,2})?$/.test(net)) throw new Error("Capital invalide");
  const [entier, frac = ""] = net.split(",");
  if (entier === undefined || entier.length > 12) throw new Error("Capital invalide");
  return Number(entier) * 100 + Number((frac + "00").slice(0, 2));
}

export function saisieDepuisCentimes(centimes: number | null): string {
  if (centimes === null) return "";
  const entier = Math.trunc(centimes / 100);
  const cent = Math.abs(centimes % 100);
  if (cent === 0) return String(entier);
  return `${String(entier)},${String(cent).padStart(2, "0")}`;
}
