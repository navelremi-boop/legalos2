import { contactsProposables, filtrerContacts, type ContactListe } from "@/contacts/listeContacts";

/** Nombre maximal de propositions sous le champ « Avec ». */
export const MAX_CANDIDATS_LIEN = 6;

/**
 * Fiches proposées sous le champ « Avec » d'un lien : recherche dans l'annuaire (nom, prénoms, SIREN, TVA), sans
 * la fiche qui porte le lien ni les fiches archivées. Rien tant que rien n'est saisi.
 */
export function candidatsLien(
  contacts: readonly ContactListe[],
  sourceId: string,
  recherche: string,
  max: number = MAX_CANDIDATS_LIEN,
): ContactListe[] {
  if (recherche.trim() === "") return [];
  const autres = contactsProposables(contacts).filter((contact) => contact.id !== sourceId);
  return filtrerContacts(autres, "tous", recherche).slice(0, max);
}
