/**
 * Fichiers temporaires / enregistrements automatiques : ne déclenchent pas de version.
 * Règle pure, testée unitairement (noms `~$…`, `.tmp`, `.asd`, `AutoRecovery`).
 */
export function estFichierIgnorePourVersion(nomFichier: string): boolean {
  const base = nomFichier.replace(/^.*[/\\]/, "");
  if (base.startsWith("~$")) return true;
  const bas = base.toLowerCase();
  if (bas.endsWith(".tmp") || bas.endsWith(".asd")) return true;
  if (base.includes("AutoRecovery")) return true;
  return false;
}
