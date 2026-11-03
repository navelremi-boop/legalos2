import { communesDuCode } from "@/contacts/codesPostaux";
import { libelleForme } from "@/contacts/formesJuridiques";
import { PROFESSIONS_FICHE } from "@/contacts/professionsFiche";
import type { PropositionSiren } from "@/contacts/propositionSiren";
import type { ContactListe, NatureContactListe, ProfessionReglementee } from "@/contacts/listeContacts";

/** Logique du formulaire « Nouveau contact » (maquette `prototype-contacts.html`, rendu de création). */

export type NatureCreation = NatureContactListe;

export const NATURES_CREATION: readonly { nature: NatureCreation; libelle: string }[] = [
  { nature: "morale", libelle: "Personne morale" },
  { nature: "physique", libelle: "Personne physique" },
];

export function libelleNatureCreation(nature: NatureCreation): string {
  return NATURES_CREATION.find((entree) => entree.nature === nature)?.libelle ?? "";
}

/** Formes proposées d'emblée : SAS, SARL, SA, SCI, entreprise individuelle, association. */
const CODES_FORMES_CREATION: readonly string[] = ["5710", "5499", "5599", "6540", "1000", "9220"];

export type OptionForme = { code: string; libelle: string };

/** Formes courantes ; la forme issue du registre s'y ajoute en tête si elle n'y figure pas. */
export function optionsForme(courante: string): OptionForme[] {
  const options = CODES_FORMES_CREATION.map((code) => ({ code, libelle: libelleForme(code) }));
  const code = courante.trim();
  if (code === "" || options.some((option) => option.code === code)) return options;
  return [{ code, libelle: libelleForme(code) }, ...options];
}

/** Professions réglementées proposées à la création (celles de la maquette). */
export function professionsCreation(): readonly { code: ProfessionReglementee; libelle: string }[] {
  return PROFESSIONS_FICHE.filter((profession) => profession.code !== "commissaire_comptes").map((profession) => ({
    code: profession.code,
    libelle: profession.libelle,
  }));
}

export function sirenChiffres(saisie: string): string {
  return saisie.replace(/\D/g, "");
}

function luhn(valeur: string): boolean {
  let somme = 0;
  for (let i = 0; i < valeur.length; i += 1) {
    let chiffre = Number(valeur[valeur.length - 1 - i]);
    if (i % 2 === 1) {
      chiffre *= 2;
      if (chiffre > 9) chiffre -= 9;
    }
    somme += chiffre;
  }
  return somme % 10 === 0;
}

/** Message à afficher sous le champ SIREN, ou null si le numéro peut être cherché au registre. */
export function controleSiren(saisie: string): string | null {
  const chiffres = sirenChiffres(saisie);
  if (chiffres.length !== 9) return "Un numéro SIREN compte 9 chiffres.";
  if (!luhn(chiffres)) return "Ce numéro SIREN n'est pas valide : la clé de contrôle ne correspond pas.";
  return null;
}

/** N° de TVA intracommunautaire français déduit du SIREN ; null tant que le SIREN n'est pas valide. */
export function tvaCalculee(saisie: string): string | null {
  if (controleSiren(saisie) !== null) return null;
  const siren = sirenChiffres(saisie);
  const cle = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(cle).padStart(2, "0")}${siren}`;
}

/** Fiche déjà là pour ce SIREN. */
export function doublonSiren(saisie: string, contacts: readonly ContactListe[]): ContactListe | null {
  const chiffres = sirenChiffres(saisie);
  if (chiffres.length !== 9) return null;
  return contacts.find((contact) => contact.nature === "morale" && sirenChiffres(contact.siren ?? "") === chiffres) ?? null;
}

export type AdresseSaisie = { voie: string; codePostal: string; commune: string };

/** Sépare « 8 quai Saint-Vincent 69001 Lyon » en voie, code postal et commune. Sans code postal : tout dans la voie. */
export function analyserAdresse(adresse: string): AdresseSaisie {
  const texte = adresse.trim().replace(/\s+/gu, " ");
  const trouve = /^(.*?)[\s,]*\b(\d{5})\s+(\D.*)$/u.exec(texte);
  if (trouve === null) return { voie: texte, codePostal: "", commune: "" };
  return { voie: trouve[1] ?? "", codePostal: trouve[2] ?? "", commune: (trouve[3] ?? "").trim() };
}

/** Adresse en une ligne : voie, puis code postal et commune. Null si rien n'est saisi. */
export function assemblerAdresse(saisie: AdresseSaisie): string | null {
  const voie = saisie.voie.trim();
  const ville = `${saisie.codePostal.trim()} ${saisie.commune.trim()}`.trim();
  const morceaux = [voie, ville].filter((morceau) => morceau !== "");
  return morceaux.length === 0 ? null : morceaux.join(", ");
}

function plier(valeur: string): string {
  return valeur.normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("fr");
}

/** Communes du code postal ; la commune déjà connue (registre) s'ajoute en tête si la base ne la porte pas. */
export function optionsCommune(codePostal: string, courante: string): string[] {
  const communes = codePostal.trim().length === 5 ? [...communesDuCode(codePostal)] : [];
  const nette = courante.trim();
  if (communes.length === 0 || nette === "") return communes;
  const pliee = plier(nette);
  if (communes.some((commune) => plier(commune) === pliee || plier(commune).startsWith(`${pliee} `))) return communes;
  return [nette, ...communes];
}

/** Commune retenue : la saisie si elle figure parmi les options, sinon la première option, sinon la saisie libre. */
export function communeRetenue(codePostal: string, saisie: string): string {
  const options = optionsCommune(codePostal, saisie);
  if (options.length === 0) return saisie.trim();
  const pliee = plier(saisie.trim());
  const trouvee =
    pliee === ""
      ? undefined
      : options.find((commune) => plier(commune) === pliee || plier(commune).startsWith(`${pliee} `));
  return trouvee ?? options[0] ?? "";
}

export type ChampsRegistre = {
  denomination: string;
  forme: string;
  voie: string;
  codePostal: string;
  commune: string;
  activite: string;
};

/** Champs du formulaire proposés par le registre. Une valeur absente du registre reste vide. */
export function champsDepuisProposition(proposition: PropositionSiren): ChampsRegistre {
  const adresse = analyserAdresse(proposition.adresseSiege ?? "");
  return {
    denomination: proposition.denomination?.trim() ?? "",
    forme: proposition.forme?.trim() ?? "",
    voie: adresse.voie,
    codePostal: adresse.codePostal,
    commune: adresse.commune,
    activite: proposition.activite?.trim() ?? "",
  };
}

/** Capital saisi en euros entiers : les espaces de milliers sont admis. Null si le champ est vide. */
export function capitalEnCentimes(saisie: string): number | null {
  const euros = saisie.replace(/\s/gu, "");
  if (euros === "") return null;
  if (!/^\d+$/u.test(euros)) throw new Error("Le capital s'écrit en euros entiers.");
  return Number(euros) * 100;
}
