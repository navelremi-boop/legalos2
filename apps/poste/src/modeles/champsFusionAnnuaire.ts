import { designationActe, ficheRepresentant, type ContexteDesignation } from "@/contacts/designation";
import type { ContactListe } from "@/contacts/listeContacts";
import type { LienAffiche } from "@/contacts/liensContacts";
import type { DonneesFusion, LigneIntervenant } from "@/modeles/fusionDocx";

export type PartieFusion = {
  role: string;
  contactId: string | null;
};

export type IntervenantFusion = {
  id: string;
  contactId: string;
  code: string;
  rattacheA: string | null;
};

function texteComplet(contact: ContactListe, contexte: ContexteDesignation): string {
  const acte = designationActe(contact, contexte);
  return acte.mentions.length === 0 ? acte.texte : "";
}

function adresseDe(contact: ContactListe): string {
  const domicile = contact.adresseDomicile?.trim() ?? "";
  if (domicile !== "") return domicile;
  return contact.adresseSiege?.trim() ?? "";
}

/**
 * Champs d'annuaire d'un dossier. `client_nom` n'est pas ici : il reste le nom de la partie.
 * Une désignation incomplète devient une chaîne vide, pour que seul un modèle qui l'utilise s'arrête.
 */
export function champsAnnuaireFusion(entree: {
  parties: readonly PartieFusion[];
  intervenants: readonly IntervenantFusion[];
  codes: readonly string[];
  contacts: readonly ContactListe[];
  liens: readonly LienAffiche[];
}): DonneesFusion {
  const contexte: ContexteDesignation = { liens: entree.liens, contacts: entree.contacts };
  const parId = new Map(entree.contacts.map((contact) => [contact.id, contact]));
  const fiche = (contactId: string | null | undefined): ContactListe | undefined =>
    contactId === null || contactId === undefined ? undefined : parId.get(contactId);
  const client = fiche(entree.parties.find((partie) => partie.role === "client")?.contactId);
  const adversaire = fiche(entree.parties.find((partie) => partie.role === "adversaire")?.contactId);
  const representant =
    client?.nature === "morale" ? ficheRepresentant(client.id, contexte) : null;

  const champs: Record<string, string | LigneIntervenant[]> = {
    client_designation: client === undefined ? "" : texteComplet(client, contexte),
    client_adresse: client === undefined ? "" : adresseDe(client),
    client_representant_designation: representant === null ? "" : texteComplet(representant, contexte),
    adversaire_designation: adversaire === undefined ? "" : texteComplet(adversaire, contexte),
  };

  const parIntervenant = new Map(entree.intervenants.map((ligne) => [ligne.id, ligne]));
  const lignes = new Map<string, LigneIntervenant[]>();
  for (const code of entree.codes) {
    if (!/^[A-Za-z0-9_]+$/.test(code)) continue;
    lignes.set(`intervenants_${code}`, []);
  }
  for (const ligne of entree.intervenants) {
    if (!/^[A-Za-z0-9_]+$/.test(ligne.code)) continue;
    const contact = fiche(ligne.contactId);
    const parent = ligne.rattacheA === null ? undefined : parIntervenant.get(ligne.rattacheA);
    const parentContact = parent === undefined ? undefined : fiche(parent.contactId);
    const cle = `intervenants_${ligne.code}`;
    const liste = lignes.get(cle) ?? [];
    liste.push({
      nom: contact?.nom ?? "",
      designation: contact === undefined ? "" : texteComplet(contact, contexte),
      adresse: contact === undefined ? "" : adresseDe(contact),
      rattache_a: parentContact?.nom ?? "",
    });
    lignes.set(cle, liste);
  }
  for (const [cle, liste] of lignes) champs[cle] = liste;
  return champs;
}
