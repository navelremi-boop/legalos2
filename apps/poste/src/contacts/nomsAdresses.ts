import { nomCourtContact, type ContactListe, type CoordonneeLue } from "@/contacts/listeContacts";

/**
 * Nom affiché de chaque adresse e-mail de l'annuaire (« M. Antoine Ferrand », « SAS Ferrand Métal »), clé en
 * minuscules. Une adresse portée par deux fiches garde la première rencontrée ; une fiche archivée n'est pas écartée,
 * puisque le mail a bien été échangé avec elle.
 */
export function nomsParAdresse(
  contacts: readonly ContactListe[],
  coordonnees: readonly CoordonneeLue[],
): Map<string, string> {
  const parId = new Map(contacts.map((contact) => [contact.id, contact]));
  const noms = new Map<string, string>();
  for (const ligne of coordonnees) {
    if (ligne.genre !== "email") continue;
    const adresse = ligne.valeur.trim().toLocaleLowerCase("fr");
    const contact = parId.get(ligne.contactId);
    if (adresse === "" || contact === undefined || noms.has(adresse)) continue;
    const nom = nomCourtContact(contact);
    if (nom !== "") noms.set(adresse, nom);
  }
  return noms;
}
