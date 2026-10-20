import { appeler, type ResultatApi } from "@/messagerie/appelApi";
import {
  requeteAjouterBoite,
  requeteReconnecterBoite,
  type ChampsConnexion,
} from "@/messagerie/formesConnexionBoite";
import type { RequeteApi } from "@/messagerie/formesApiRedaction";

/** Ajout et reconnexion d'une boîte : appels à l'API, en ligne seulement. Les identifiants partent et ne reviennent pas. */

function executer(instanceUrl: string, requete: RequeteApi): Promise<ResultatApi<null>> {
  return appeler(instanceUrl, requete.methode, requete.chemin, {
    corps: JSON.stringify(requete.corps ?? {}),
    typeContenu: "application/json",
    delaiMs: 20_000,
    lire: () => null,
  });
}

export function ajouterBoite(instanceUrl: string, id: string, champs: ChampsConnexion): Promise<ResultatApi<null>> {
  return executer(instanceUrl, requeteAjouterBoite(id, champs));
}

export function reconnecterBoite(
  instanceUrl: string,
  compteId: string,
  champs: ChampsConnexion,
): Promise<ResultatApi<null>> {
  return executer(instanceUrl, requeteReconnecterBoite(compteId, champs));
}
