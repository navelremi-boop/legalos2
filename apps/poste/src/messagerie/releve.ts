/**
 * Témoin « Boîtes relevées il y a … » de l'en-tête de l'écran. La date de dernière relève est une donnée du
 * serveur (tableau de santé, étape 3 du jalon) : sans elle, le témoin n'est pas affiché, rien n'est inventé.
 */

/** « il y a 1 min », « il y a 2 h », « il y a 3 jours » ; « à l'instant » sous une minute. `null` si la date est illisible. */
export function libelleReleve(derniereReleve: string | null | undefined, maintenant: Date): string | null {
  if (derniereReleve === null || derniereReleve === undefined || derniereReleve.trim() === "") return null;
  const instant = Date.parse(derniereReleve);
  if (Number.isNaN(instant)) return null;
  const secondes = Math.max(0, Math.floor((maintenant.getTime() - instant) / 1000));
  if (secondes < 60) return "Boîtes relevées à l'instant";
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return `Boîtes relevées il y a ${String(minutes)} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `Boîtes relevées il y a ${String(heures)} h`;
  const jours = Math.floor(heures / 24);
  return `Boîtes relevées il y a ${String(jours)} ${jours > 1 ? "jours" : "jour"}`;
}
