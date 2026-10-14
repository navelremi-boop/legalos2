import { appeler, type ResultatApi } from "@/messagerie/appelApi";
import type { ModeleMessage } from "@/messagerie/corpsRedaction";
import {
  lireCompteDeComposition,
  lireComptes,
  lireModele,
  lireModeles,
  lireSignature,
  requeteCompteDeComposition,
  requeteComptes,
  requeteCreerModele,
  requeteEcrireSignature,
  requeteLireSignature,
  requeteModeles,
  requeteModifierModele,
  requeteSupprimerModele,
  type ChampsModele,
  type CompteMessagerie,
  type RequeteApi,
  type SignatureCompte,
} from "@/messagerie/formesApiRedaction";

/**
 * Signatures, modèles de message et compte de composition : appels à l'API (en ligne seulement). Les formes des
 * requêtes et la lecture des réponses sont dans `formesApiRedaction.ts`.
 */

const DELAI_MS = 12_000;
/** Ouverture d'un message : on n'attend pas le serveur plus longtemps que cela pour la signature. */
export const DELAI_OUVERTURE_MS = 4_000;

function executer<T>(
  instanceUrl: string,
  requete: RequeteApi,
  lire: (json: unknown) => T,
  delaiMs = DELAI_MS,
): Promise<ResultatApi<T>> {
  return appeler(instanceUrl, requete.methode, requete.chemin, {
    corps: requete.corps === undefined ? undefined : JSON.stringify(requete.corps),
    typeContenu: requete.corps === undefined ? undefined : "application/json",
    delaiMs,
    lire,
  });
}

export function listerComptes(instanceUrl: string): Promise<ResultatApi<CompteMessagerie[]>> {
  return executer(instanceUrl, requeteComptes(), lireComptes);
}

export function lireSignatureCompte(
  instanceUrl: string,
  compteId: string,
  delaiMs = DELAI_MS,
): Promise<ResultatApi<SignatureCompte>> {
  return executer(instanceUrl, requeteLireSignature(compteId), (json) => lireSignature(json, compteId), delaiMs);
}

export function ecrireSignatureCompte(
  instanceUrl: string,
  compteId: string,
  html: string,
): Promise<ResultatApi<SignatureCompte>> {
  return executer(instanceUrl, requeteEcrireSignature(compteId, html), (json) => lireSignature(json, compteId));
}

/** Compte que le serveur désigne pour un message (celui du message d'origine, ou la boîte du cabinet pour un message neuf). */
export function compteDeComposition(
  instanceUrl: string,
  genre: "nouveau" | "reponse" | "reponse_a_tous" | "transfert",
  messageId: string | null,
  delaiMs = DELAI_MS,
): Promise<ResultatApi<string | null>> {
  return executer(instanceUrl, requeteCompteDeComposition(genre, messageId), lireCompteDeComposition, delaiMs);
}

export function listerModeles(instanceUrl: string): Promise<ResultatApi<ModeleMessage[]>> {
  return executer(instanceUrl, requeteModeles(), lireModeles);
}

export function creerModele(
  instanceUrl: string,
  id: string,
  champs: ChampsModele,
): Promise<ResultatApi<ModeleMessage | null>> {
  return executer(instanceUrl, requeteCreerModele(id, champs), lireModele);
}

export function modifierModele(
  instanceUrl: string,
  id: string,
  champs: Partial<ChampsModele>,
): Promise<ResultatApi<ModeleMessage | null>> {
  return executer(instanceUrl, requeteModifierModele(id, champs), lireModele);
}

export function supprimerModele(instanceUrl: string, id: string): Promise<ResultatApi<null>> {
  return executer(instanceUrl, requeteSupprimerModele(id), () => null);
}
