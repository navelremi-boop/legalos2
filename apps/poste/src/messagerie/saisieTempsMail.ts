import { enregistrerTemps, tauxHoraireParDefaut, type BaseTemps, type ResultatSaisieTemps } from "@/facturation/ecrireTemps";
import { propositionTemps, type ActeMail } from "@/messagerie/tempsMail";

/**
 * Enregistre le temps d'un mail une fois l'utilisateur d'accord : le chemin d'écriture des temps du poste
 * (`facturation/ecrireTemps.ts`), avec le taux horaire du cabinet figé à cet instant et le libellé tiré du traitement du
 * mail. Les minutes sont celles que l'utilisateur a validées, éventuellement corrigées.
 */
export async function saisirTempsDuMail(
  base: BaseTemps,
  entree: {
    dossierId: string;
    minutes: number;
    actes: readonly ActeMail[];
    intervenantId: string | null;
    maintenant?: Date;
  },
): Promise<ResultatSaisieTemps> {
  const taux = await tauxHoraireParDefaut(base);
  return enregistrerTemps(base, {
    dossierId: entree.dossierId,
    minutes: entree.minutes,
    libelle: propositionTemps(entree.actes).libelle,
    tauxCentimesHeure: taux,
    intervenantId: entree.intervenantId,
    maintenant: entree.maintenant,
  });
}
