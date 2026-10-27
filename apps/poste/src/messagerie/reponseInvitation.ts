import { apiUrl } from "@/lib/auth/client";
import { assurerJetonAcces } from "@/lib/session/rafraichir";
import { messageEchecReponse } from "@/messagerie/erreursHttp";
import { cheminReponseInvitation } from "@/messagerie/invitations";

/**
 * Réponse à une invitation reçue (accepter, peut-être, refuser) : l'API la transmet à l'organisateur.
 *
 * Route de l'API (étape 2 du jalon) : POST /messagerie/invitations/{id}/reponse,
 * `{ "reponse": "accepter" | "peut_etre" | "refuser" }` (`cheminReponseInvitation`). Un échec porte un message en
 * français, et rien n'est simulé.
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
  const jeton = await assurerJetonAcces();
  if (jeton === null) {
    throw new ErreurReponseInvitation("La session a expiré. Reconnectez-vous.");
  }
  let resultat: Response;
  try {
    resultat = await fetch(apiUrl(instanceUrl, cheminReponseInvitation(invitationId)), {
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
