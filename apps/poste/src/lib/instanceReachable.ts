import { normalizeInstanceUrl } from "@/lib/auth/client";

/**
 * Sonde la disponibilité réelle de l'instance (pas seulement `navigator.onLine`).
 * `/health` et `/api/health` sont tous deux routés vers l'API par Caddy.
 */
export async function instanceReachable(instanceUrl: string, timeoutMs = 2_500): Promise<boolean> {
  const base = normalizeInstanceUrl(instanceUrl);
  const controleur = new AbortController();
  const timer = window.setTimeout(() => {
    controleur.abort();
  }, timeoutMs);
  try {
    const reponse = await fetch(`${base}/health`, {
      method: "GET",
      signal: controleur.signal,
      cache: "no-store",
    });
    return reponse.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
