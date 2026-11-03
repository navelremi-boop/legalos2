import {
  assemblerAdresse,
  capitalEnCentimes,
  communeRetenue,
} from "@/contacts/creationContact";
import { champsFicheVides, libelleCapital, type ContactListe } from "@/contacts/listeContacts";
import { tvaSaisie } from "@/contacts/tvaFiche";
import { verifierSirenTva } from "@/dossiers/identifiants";

export type FicheACreer = {
  nom: string;
  siren: string;
  numeroTva: string | null;
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
  /** Voie du siège ; le code postal et la commune s'y ajoutent s'ils sont saisis. */
  adresse: string;
  codePostal?: string;
  commune?: string;
  /** Numéro de TVA saisi ou calculé ; vide : aucun. */
  tva?: string;
  greffe: string;
  capitalEuros: string;
  depuisRegistre: boolean;
}): FicheACreer {
  const siren = saisie.siren.trim();
  verifierSirenTva(siren);
  if (siren.replace(/\D/g, "") === "") throw new Error("SIREN requis.");
  const nom = saisie.denomination.trim();
  if (nom === "") throw new Error("Dénomination requise.");
  const capitalCentimes = capitalEnCentimes(saisie.capitalEuros);
  const sirenNet = siren.replace(/\D/g, "");
  const tva = tvaSaisie(sirenNet, saisie.tva ?? "");
  if (tva.message !== null) throw new Error(tva.message);
  const codePostal = saisie.codePostal?.trim() ?? "";
  return {
    nom,
    siren: sirenNet,
    numeroTva: tva.valeur,
    forme: net(saisie.forme),
    activite: net(saisie.activite),
    adresseSiege: assemblerAdresse({
      voie: saisie.adresse,
      codePostal,
      commune: communeRetenue(codePostal, saisie.commune ?? ""),
    }),
    greffe: net(saisie.greffe),
    capitalCentimes,
    depuisRegistre: saisie.depuisRegistre,
  };
}

/** Ligne de liste de la société créée, affichée sans attendre la synchronisation. */
export function contactDepuisSociete(fiche: FicheACreer, id: string): ContactListe {
  return {
    id,
    nature: "morale",
    nom: fiche.nom,
    siren: fiche.siren,
    numeroTva: fiche.numeroTva,
    typeClient: "professionnel",
    professionReglementee: false,
    ...champsFicheVides(),
    forme: fiche.forme,
    activite: fiche.activite,
    adresseSiege: fiche.adresseSiege,
    greffe: fiche.greffe,
    capitalCentimes: fiche.capitalCentimes,
    monnaie: fiche.capitalCentimes === null ? null : "EUR",
    capitalLibelle: fiche.capitalCentimes === null ? null : libelleCapital(fiche.capitalCentimes, "EUR"),
  };
}

/** Corps de `POST /contacts` pour une société. */
export function corpsCreationSociete(fiche: FicheACreer, id: string, cleIdempotence: string): Record<string, unknown> {
  return {
    id,
    idempotence_cle: cleIdempotence,
    nature: "morale",
    nom: fiche.nom,
    siren: fiche.siren,
    numero_tva: fiche.numeroTva,
    type_client: "professionnel",
    forme: fiche.forme,
    activite: fiche.activite,
    greffe_rcs: fiche.greffe,
    capital_centimes: fiche.capitalCentimes,
    monnaie: fiche.capitalCentimes === null ? null : "EUR",
    depuis_registre: fiche.depuisRegistre,
  };
}
