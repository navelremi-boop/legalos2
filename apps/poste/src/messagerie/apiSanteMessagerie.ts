import { appeler, type ResultatApi } from "@/messagerie/appelApi";
import { lireSante, requeteSante, type SanteMessagerie } from "@/messagerie/formesSanteMessagerie";

/** Tableau de santé des boîtes : appel à l'API, en ligne seulement. */
export function lireSanteMessagerie(instanceUrl: string): Promise<ResultatApi<SanteMessagerie>> {
  const requete = requeteSante();
  return appeler(instanceUrl, requete.methode, requete.chemin, { delaiMs: 12_000, lire: lireSante });
}
