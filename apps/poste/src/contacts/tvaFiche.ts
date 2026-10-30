import { verifierSirenTva } from "@/dossiers/identifiants";
import { texteSaisi } from "@/contacts/texteSaisi";

export type TvaSaisie = {
  valeur: string | null;
  message: string | null;
};

/** Vide : retire le numéro. FR : clé et même SIREN que la fiche. */
export function tvaSaisie(siren: string | null, saisie: string): TvaSaisie {
  const net = texteSaisi(saisie);
  if (net === null) return { valeur: null, message: null };
  const compact = net.replace(/\s/g, "").toUpperCase();
  try {
    verifierSirenTva(undefined, compact);
  } catch (erreur) {
    return { valeur: null, message: erreur instanceof Error ? erreur.message : "Numéro de TVA invalide." };
  }
  if (compact.startsWith("FR")) {
    const sirenTva = compact.slice(4);
    const sirenContact = (siren ?? "").replace(/[^0-9]/g, "");
    if (sirenContact !== "" && sirenContact !== sirenTva) {
      return { valeur: null, message: "Numéro de TVA invalide." };
    }
  }
  return { valeur: compact, message: null };
}
