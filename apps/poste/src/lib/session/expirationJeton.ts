/** Secondes `exp` d'un JWT, lues sans vérifier la signature. `null` si le jeton est illisible. */
export function expirationJetonSec(jeton: string): number | null {
  const partie = jeton.split(".")[1];
  if (partie === undefined || partie === "") return null;
  try {
    const json: unknown = JSON.parse(atob(partie.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof json !== "object" || json === null || !("exp" in json)) return null;
    const exp = json.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** Vrai si le jeton est illisible, expiré, ou s'il expire dans moins de `margeMs`. */
export function jetonExpireBientot(jeton: string, maintenantMs: number, margeMs: number): boolean {
  const exp = expirationJetonSec(jeton);
  if (exp === null) return true;
  return exp * 1000 <= maintenantMs + margeMs;
}
