import { apiUrl } from "@/lib/auth/client";
import { loadSessionTokens } from "@/lib/session/storage";
import { messageEchecReponse } from "@/messagerie/erreursHttp";

/**
 * Réponse à une invitation reçue (accepter, peut-être, refuser) : l'API la transmet à l'organisateur.
 *
 * Cette route n'existe pas encore (étape 2 du jalon). Le module l'appelle quand même : tant qu'elle manque,
 * l'appel échoue avec un message en français, et rien n'est simulé. Chemin et corps attendus, à confirmer
 * avec l'étape 2 : POST /messagerie/invitations/{id}/repondre, `{ "reponse": "accepter" | "peut_etre" | "refuser" }`.
 */

export type ReponseInvitation = "accepter" | "peut_etre" | "refuser";

export const REPONSES_INVITATION: readonly { reponse: ReponseInvitation; libelle: string }[] = [
  { reponse: "accepter", libelle: "Accepter" },
  { reponse: "peut_etre", libelle: "Peut-être" },
  { reponse: "refuser", libelle: "Refuser" },
];

export class ErreurReponseInvitation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurReponseInvitation";
  }
}

/**
 * Envoie la réponse à l'organisateur. Lève `ErreurReponseInvitation` (message en français) si elle n'a pas
 * pu l'être ; ne retourne que lorsque l'API a accepté la réponse.
 */
export async function reponseInvitation(
  instanceUrl: string,
  invitationId: string,
  reponse: ReponseInvitation,
): Promise<void> {
  const jeton = loadSessionTokens().accessToken;
  if (jeton === null || jeton === "") {
    throw new ErreurReponseInvitation("La session a expiré. Reconnectez-vous.");
  }
  let resultat: Response;
  try {
    resultat = await fetch(apiUrl(instanceUrl, `/messagerie/invitations/${invitationId}/repondre`), {
      method: "POST",
      headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: JSON.stringify({ reponse }),
    });
  } catch {
    throw new ErreurReponseInvitation("L'instance est injoignable. La réponse n'a pas été envoyée.");
  }
  if (resultat.ok) return;
  let corps: unknown = null;
  try {
    corps = (await resultat.json()) as unknown;
  } catch {
    corps = null;
  }
  throw new ErreurReponseInvitation(messageEchecReponse(resultat.status, corps));
}
