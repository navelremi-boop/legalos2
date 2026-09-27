/**
 * Échappe `\`, `%` et `_` pour un motif SQLite `LIKE … ESCAPE '\'`.
 * `_` est un séparateur autorisé du modèle de référence (R0).
 */
export function echapperMotifLike(terme: string): string {
  return terme.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
