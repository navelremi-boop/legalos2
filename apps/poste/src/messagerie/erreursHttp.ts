/** Messages d'erreur en français pour les réponses HTTP de l'API (fonctions pures). */

/** Message d'erreur de l'API (`{ code, message }`) ou, à défaut, un texte selon le statut HTTP. */
export function messageErreurHttp(statut: number, corps: unknown): string {
  if (typeof corps === "object" && corps !== null) {
    const message = (corps as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message.trim();
  }
  if (statut === 401) return "La session a expiré. Reconnectez-vous.";
  if (statut === 403) return "Vous n'avez pas le droit de faire cela.";
  if (statut === 404) return "Élément introuvable.";
  return "Le serveur n'a pas pu répondre.";
}

export const MESSAGE_ROUTE_ABSENTE =
  "La réponse aux invitations n'est pas encore disponible sur cette instance.";

/**
 * Message à montrer pour une réponse HTTP en échec. Un 404, 405 ou 501 sans message de l'API est une route
 * absente ; un message de l'API (`{ code, message }`) est repris tel quel.
 */
export function messageEchecReponse(statut: number, corps: unknown): string {
  const porteUnMessage =
    typeof corps === "object" &&
    corps !== null &&
    typeof (corps as { message?: unknown }).message === "string" &&
    (corps as { message: string }).message.trim() !== "";
  if (!porteUnMessage && (statut === 404 || statut === 405 || statut === 501)) return MESSAGE_ROUTE_ABSENTE;
  return messageErreurHttp(statut, corps);
}

