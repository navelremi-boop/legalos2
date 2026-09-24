const FINE_NBSP = "\u202f";
const NBSP = "\u00a0";

/**
 * Mise en forme typographique française pour l’interface (cahier § 7.6).
 * À appliquer à toute chaîne affichée à l’utilisateur.
 */
export function fr(text: string): string {
  let out = text.replace(/'/g, "\u2019");

  out = out.replace(/\s+:/g, `${FINE_NBSP}:`);
  out = out.replace(/\s+;/g, `${FINE_NBSP};`);
  out = out.replace(/\s+\?/g, `${FINE_NBSP}?`);
  out = out.replace(/\s+!/g, `${FINE_NBSP}!`);

  out = out.replace(/«\s*/g, `«${NBSP}`);
  out = out.replace(/\s*»/g, `${NBSP}»`);

  out = out.replace(/(\d)\s*€/g, `$1${NBSP}€`);
  out = out.replace(/\bMe\s+/g, `Me${NBSP}`);
  out = out.replace(/\bn°\s+/g, `n°${NBSP}`);

  return out;
}
