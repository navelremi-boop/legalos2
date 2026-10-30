import { verifierSirenTva } from "@/dossiers/identifiants";
import { texteSaisi } from "@/contacts/texteSaisi";

export type SirenSaisi = {
  valeur: string | null;
  message: string | null;
};

/** Vide : retire le SIREN. Sinon, clé de Luhn et cohérence avec le numéro de TVA. */
export function sirenSaisi(tva: string | null, saisie: string): SirenSaisi {
  const net = texteSaisi(saisie);
  if (net === null) return { valeur: null, message: null };
  const chiffres = net.replace(/[^0-9]/g, "");
  try {
    verifierSirenTva(chiffres, tva ?? undefined);
  } catch (erreur) {
    return { valeur: null, message: erreur instanceof Error ? erreur.message : "SIREN invalide." };
  }
  return { valeur: chiffres, message: null };
}
