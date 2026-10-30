import { texteSaisi } from "@/contacts/texteSaisi";
import type { AccordGrammatical, ContactListe } from "@/contacts/listeContacts";

/** Liste de départ du cabinet. « Mademoiselle » n'en fait pas partie. */
export const CIVILITES_DEPART = ["Madame", "Monsieur", "Maître"] as const;

export type IdentiteSaisie = {
  civilite: string | null;
  accord: AccordGrammatical | null;
  prenoms: string | null;
  nom: string;
  nomNaissance: string | null;
  dateNaissance: string | null;
  lieuNaissance: string | null;
  nationalite: string | null;
  profession: string | null;
};

export function civiliteRefusee(valeur: string): boolean {
  return valeur.trim().toLocaleLowerCase("fr") === "mademoiselle";
}

/** Madame et Monsieur déduisent l'accord. Toute autre civilité le demande. */
export function accordDemande(civilite: string | null): boolean {
  const net = civilite?.trim() ?? "";
  if (net === "" || civiliteRefusee(net)) return false;
  return net !== "Madame" && net !== "Monsieur";
}

export function dateNaissanceValide(valeur: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const date = new Date(`${valeur}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
}

export function optionsCivilite(actuelle: string | null): string[] {
  const options: string[] = [...CIVILITES_DEPART];
  const net = actuelle?.trim() ?? "";
  if (net !== "" && !civiliteRefusee(net) && !options.includes(net)) options.push(net);
  return options;
}

/** Null si la civilité est refusée, si le nom est vide, ou si la date est illisible. */
export function normaliserIdentite(saisie: IdentiteSaisie): IdentiteSaisie | null {
  const civilite = saisie.civilite?.trim() ?? "";
  if (civiliteRefusee(civilite)) return null;
  const nom = saisie.nom.trim();
  if (nom === "") return null;
  const date = saisie.dateNaissance?.trim() ?? "";
  if (date !== "" && !dateNaissanceValide(date)) return null;
  const demandee = accordDemande(civilite === "" ? null : civilite);
  const accord = demandee && (saisie.accord === "masculin" || saisie.accord === "feminin") ? saisie.accord : null;
  return {
    civilite: civilite === "" ? null : civilite,
    accord,
    prenoms: texteSaisi(saisie.prenoms ?? ""),
    nom,
    nomNaissance: texteSaisi(saisie.nomNaissance ?? ""),
    dateNaissance: date === "" ? null : date,
    lieuNaissance: texteSaisi(saisie.lieuNaissance ?? ""),
    nationalite: texteSaisi(saisie.nationalite ?? ""),
    profession: texteSaisi(saisie.profession ?? ""),
  };
}

export function identiteDepuis(contact: ContactListe): IdentiteSaisie {
  return {
    civilite: contact.civilite,
    accord: contact.accordSaisi,
    prenoms: contact.prenoms,
    nom: contact.nom,
    nomNaissance: contact.nomNaissance,
    dateNaissance: contact.dateNaissance,
    lieuNaissance: contact.lieuNaissance,
    nationalite: contact.nationalite,
    profession: contact.profession,
  };
}

export function appliquerIdentite(contact: ContactListe, identite: IdentiteSaisie | undefined): ContactListe {
  if (identite === undefined) return contact;
  return {
    ...contact,
    civilite: identite.civilite,
    accordSaisi: identite.accord,
    prenoms: identite.prenoms,
    nom: identite.nom,
    nomNaissance: identite.nomNaissance,
    dateNaissance: identite.dateNaissance,
    lieuNaissance: identite.lieuNaissance,
    nationalite: identite.nationalite,
    profession: identite.profession,
  };
}
