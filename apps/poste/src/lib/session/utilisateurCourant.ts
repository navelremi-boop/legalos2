/**
 * Identifiant utilisateur porté par le jeton d’accès (`sub` du JWT).
 * Décodage local du payload uniquement — pas de vérification cryptographique
 * (le serveur reste la source d’autorité).
 */
export function utilisateurIdDepuisJeton(jeton: string | null | undefined): string | null {
  if (jeton === null || jeton === undefined || jeton.trim() === "") {
    return null;
  }
  const segment = jeton.split(".")[1];
  if (segment === undefined || segment === "") {
    return null;
  }
  try {
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const corps = JSON.parse(json) as unknown;
    if (corps === null || typeof corps !== "object" || !("sub" in corps)) {
      return null;
    }
    const sub = corps.sub;
    if (typeof sub === "string" && sub.trim() !== "") {
      return sub.trim();
    }
    return null;
  } catch {
    return null;
  }
}
