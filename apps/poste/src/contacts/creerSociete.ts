import { verifierSirenTva } from "@/dossiers/identifiants";

export type FicheACreer = {
  nom: string;
  siren: string;
  forme: string | null;
  activite: string | null;
  adresseSiege: string | null;
  greffe: string | null;
  capitalCentimes: number | null;
  depuisRegistre: boolean;
};

function net(valeur: string): string | null {
  const texte = valeur.trim();
  return texte === "" ? null : texte;
}

/** Champs de la fiche à créer. Le capital et le greffe viennent de la saisie, pas du registre. */
export function preparerCreation(saisie: {
  siren: string;
  denomination: string;
  forme: string;
  activite: string;
  adresse: string;
  greffe: string;
  capitalEuros: string;
  depuisRegistre: boolean;
}): FicheACreer {
  const siren = saisie.siren.trim();
  verifierSirenTva(siren);
  if (siren.replace(/\D/g, "") === "") throw new Error("SIREN requis.");
  const nom = saisie.denomination.trim();
  if (nom === "") throw new Error("Dénomination requise.");
  const euros = saisie.capitalEuros.trim();
  let capitalCentimes: number | null = null;
  if (euros !== "") {
    if (!/^\d+$/.test(euros)) throw new Error("Le capital s'écrit en euros entiers.");
    capitalCentimes = Number(euros) * 100;
  }
  return {
    nom,
    siren: siren.replace(/\D/g, ""),
    forme: net(saisie.forme),
    activite: net(saisie.activite),
    adresseSiege: net(saisie.adresse),
    greffe: net(saisie.greffe),
    capitalCentimes,
    depuisRegistre: saisie.depuisRegistre,
  };
}
