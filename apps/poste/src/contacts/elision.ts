const COMMENCE_PAR_VOYELLE = /^[AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜŒ]/iu;

/**
 * Nom de lieu précédé de « de », avec l'élision et les articles contractés :
 * « de Lyon », « d'Aix-en-Provence », « du Mans », « des Sables-d'Olonne », « de La Rochelle ».
 * Sert partout où un lieu suit « de » (cour d'appel, barreau, greffe). Vide : chaîne vide.
 * Le « h » initial n'est pas traité (« de Hyères », « de Hennebont » restent à la charge de l'avocat).
 */
export function deElide(lieu: string | null | undefined): string {
  const nom = (lieu ?? "").replace(/\s+/gu, " ").trim();
  if (nom === "") return "";
  if (/^le\s/iu.test(nom)) return `du ${nom.slice(3)}`;
  if (/^les\s/iu.test(nom)) return `des ${nom.slice(4)}`;
  if (COMMENCE_PAR_VOYELLE.test(nom)) return `d'${nom}`;
  return `de ${nom}`;
}
