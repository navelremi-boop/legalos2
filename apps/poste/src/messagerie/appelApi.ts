import { apiUrl } from "@/lib/auth/client";
import { jetonAcces, lireJsonSansEchec } from "@/messagerie/apiMessagerie";
import { messageErreurHttp } from "@/messagerie/erreursHttp";

/**
 * Appel d'une route de l'API de messagerie avec le jeton de la session : un résultat, jamais une exception.
 * Statut 0 : l'instance est injoignable (hors ligne, délai dépassé).
 */

export type ResultatApi<T> = { ok: true; valeur: T } | { ok: false; message: string; statut: number };

export type MethodeApi = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function appeler<T>(
  instanceUrl: string,
  methode: MethodeApi,
  chemin: string,
  options: { corps?: BodyInit; typeContenu?: string; delaiMs: number; lire: (json: unknown) => T },
): Promise<ResultatApi<T>> {
  const jeton = jetonAcces();
  if (jeton === null) return { ok: false, statut: 401, message: "La session a expiré. Reconnectez-vous." };
  try {
    const reponse = await fetch(apiUrl(instanceUrl, chemin), {
      method: methode,
      headers: {
        authorization: `Bearer ${jeton}`,
        ...(options.typeContenu === undefined ? {} : { "content-type": options.typeContenu }),
      },
      body: options.corps,
      signal: AbortSignal.timeout(options.delaiMs),
    });
    const json = await lireJsonSansEchec(reponse);
    if (!reponse.ok) {
      return { ok: false, statut: reponse.status, message: messageErreurHttp(reponse.status, json) };
    }
    return { ok: true, valeur: options.lire(json) };
  } catch {
    return { ok: false, statut: 0, message: "L'instance est injoignable." };
  }
}
