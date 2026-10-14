import { apiUrl } from "@/lib/auth/client";
import { loadSessionTokens } from "@/lib/session/storage";
import { messageErreurHttp } from "@/messagerie/erreursHttp";
import type { LigneEnvoi } from "@/messagerie/typesMails";

/**
 * Appels à l'API de messagerie : seulement ce qui exige le serveur (corps d'un mail non stocké, classement,
 * file d'envoi). La lecture des mails passe par la base locale.
 */

export type ResultatAction = { ok: true } | { ok: false; message: string };

export function jetonAcces(): string | null {
  const jeton = loadSessionTokens().accessToken;
  return jeton === null || jeton === "" ? null : jeton;
}

function entetes(jeton: string, avecCorps: boolean): Record<string, string> {
  return {
    authorization: `Bearer ${jeton}`,
    ...(avecCorps ? { "content-type": "application/json" } : {}),
  };
}

export async function lireJsonSansEchec(reponse: Response): Promise<unknown> {
  try {
    return (await reponse.json()) as unknown;
  } catch {
    return null;
  }
}

async function poster(instanceUrl: string, chemin: string, corps?: unknown): Promise<ResultatAction> {
  const jeton = jetonAcces();
  if (jeton === null) return { ok: false, message: "La session a expiré. Reconnectez-vous." };
  try {
    const reponse = await fetch(apiUrl(instanceUrl, chemin), {
      method: "POST",
      headers: entetes(jeton, corps !== undefined),
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    if (reponse.ok) return { ok: true };
    return { ok: false, message: messageErreurHttp(reponse.status, await lireJsonSansEchec(reponse)) };
  } catch {
    return { ok: false, message: "L'instance est injoignable." };
  }
}

/** File d'envoi du cabinet (lecture seule). Vide si la session ou le réseau manque. */
export async function lireFileEnvoi(instanceUrl: string): Promise<LigneEnvoi[]> {
  const jeton = jetonAcces();
  if (jeton === null) return [];
  try {
    const reponse = await fetch(apiUrl(instanceUrl, "/messagerie/file-envoi"), {
      headers: entetes(jeton, false),
    });
    if (!reponse.ok) return [];
    const json = await lireJsonSansEchec(reponse);
    if (!Array.isArray(json)) return [];
    const lignes: LigneEnvoi[] = [];
    for (const ligne of json as unknown[]) {
      if (typeof ligne !== "object" || ligne === null) continue;
      const row = ligne as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.etat !== "string") continue;
      lignes.push({
        id: row.id,
        objet: typeof row.objet === "string" ? row.objet : "",
        destinataire: typeof row.destinataire === "string" ? row.destinataire : "",
        etat: row.etat,
      });
    }
    return lignes;
  } catch {
    return [];
  }
}

/** Texte d'un mail dont le corps n'est pas stocké sur le poste (récupéré à la demande par le serveur). */
export async function lireCorpsMessage(instanceUrl: string, id: string): Promise<string> {
  const jeton = jetonAcces();
  if (jeton === null) return "";
  try {
    const reponse = await fetch(apiUrl(instanceUrl, `/messagerie/messages/${id}/corps`), {
      method: "POST",
      headers: entetes(jeton, false),
    });
    if (!reponse.ok) return "";
    const json = await lireJsonSansEchec(reponse);
    if (typeof json !== "object" || json === null) return "";
    const texte = (json as { texte?: unknown }).texte;
    return typeof texte === "string" ? texte : "";
  } catch {
    return "";
  }
}

/** Classe un message dans un dossier (suggestion acceptée ou autre dossier). */
export function classerMessage(
  instanceUrl: string,
  messageId: string,
  dossierId: string,
): Promise<ResultatAction> {
  return poster(instanceUrl, `/messagerie/messages/${messageId}/classer`, { dossier_id: dossierId });
}

export function annulerEnvoi(instanceUrl: string, envoiId: string): Promise<ResultatAction> {
  return poster(instanceUrl, `/messagerie/file-envoi/${envoiId}/annuler`);
}

export function relancerEnvoi(instanceUrl: string, envoiId: string): Promise<ResultatAction> {
  return poster(instanceUrl, `/messagerie/file-envoi/${envoiId}/traiter`);
}
