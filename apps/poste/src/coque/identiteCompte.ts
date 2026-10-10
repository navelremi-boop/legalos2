import { initialesDepuis } from "@/lib/initiales";
import { loadAccountEmail } from "@/lib/session/storage";

/**
 * Initiales de l'avatar du compte, tirées de l'adresse saisie à la connexion (conservée localement :
 * disponible aussi dans la coque hors ligne). Aucune route de l'API ni table synchronisée ne donne
 * encore le nom de l'utilisateur ; `null` : icône de personne.
 */
export function initialesDuCompte(): string | null {
  return initialesDepuis(null, loadAccountEmail());
}
