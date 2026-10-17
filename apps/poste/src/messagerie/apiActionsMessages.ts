import { appeler, type ResultatApi } from "@/messagerie/appelApi";
import {
  cheminAction,
  cheminRecherche,
  corpsAction,
  lireAction,
  lireRecherche,
  type ActionAppliquee,
  type GenreAction,
  type ResultatServeur,
} from "@/messagerie/formesActionsMessages";

/** Actions sur les messages et recherche sur le serveur : appels à l'API, en ligne seulement. */

export function appliquerAction(
  instanceUrl: string,
  messageId: string,
  genre: GenreAction,
  cle: string,
  destination?: string,
): Promise<ResultatApi<ActionAppliquee>> {
  return appeler(instanceUrl, "POST", cheminAction(messageId), {
    corps: JSON.stringify(corpsAction(genre, cle, destination)),
    typeContenu: "application/json",
    delaiMs: 30_000,
    lire: lireAction,
  });
}

export function rechercherSurServeur(
  instanceUrl: string,
  terme: string,
): Promise<ResultatApi<{ resultats: ResultatServeur[]; aSuivre: boolean }>> {
  return appeler(instanceUrl, "GET", cheminRecherche(terme), { delaiMs: 12_000, lire: lireRecherche });
}
