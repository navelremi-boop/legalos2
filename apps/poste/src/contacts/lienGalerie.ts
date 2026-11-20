import type { LienAEcrire } from "@/contacts/ecrireLien";
import type { LienAffiche } from "@/contacts/liensContacts";
import { nomCourtContact, type ContactListe } from "@/contacts/listeContacts";

/**
 * Lien affiché pour un lien qui vient d'être saisi (galerie, sans base locale) : les noms viennent des fiches
 * de l'annuaire passées en argument.
 */
export function lienAfficheDepuisEcriture(
  lien: LienAEcrire,
  id: string,
  contacts: readonly ContactListe[],
): LienAffiche {
  const source = contacts.find((contact) => contact.id === lien.sourceId);
  const cible = contacts.find((contact) => contact.id === lien.cibleId);
  return {
    id,
    sourceId: lien.sourceId,
    cibleId: lien.cibleId,
    sourceCivilite: source?.civilite ?? null,
    sourcePrenoms: source?.prenoms ?? null,
    sourceNom: source?.nom ?? "",
    cibleNom: cible === undefined ? "" : nomCourtContact(cible),
    typeLien: lien.typeLien,
    fonction: lien.fonction,
    libelle: lien.libelle,
    representeSociete: lien.representeSociete,
    debut: lien.debut,
    fin: lien.fin,
    source: lien.source,
  };
}
