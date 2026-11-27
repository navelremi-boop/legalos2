import { coordonneesParContact, type ContactListe, type CoordonneeLue } from "@/contacts/listeContacts";

export type LigneIndex = {
  id: string;
  corps: string;
};

/** Dernier mot après le code postal, sinon la fin de l'adresse. */
export function villeDepuisAdresse(adresse: string | null | undefined): string {
  const texte = adresse?.trim() ?? "";
  if (texte === "") return "";
  const code = texte.match(/\b\d{5}\s+(.+)$/);
  if (code?.[1]) return code[1].trim();
  const morceaux = texte.split(",");
  return (morceaux[morceaux.length - 1] ?? "").replace(/\d/g, "").trim();
}

/** Ville pour la ligne meta : domicile ou siège, sinon première adresse des coordonnées. */
export function villeListeContact(contact: ContactListe, coords: readonly CoordonneeLue[] = []): string {
  const primaire =
    contact.nature === "morale" ? contact.adresseSiege : contact.adresseDomicile;
  const directe = villeDepuisAdresse(primaire);
  if (directe !== "") return directe;
  for (const ligne of coords) {
    if (ligne.contactId !== contact.id || ligne.genre !== "adresse") continue;
    const ville = villeDepuisAdresse(ligne.valeur);
    if (ville !== "") return ville;
  }
  return "";
}

/** Ville de chaque fiche, calculée en une passe sur les coordonnées (liste de dix mille contacts). */
export function villesParContact(
  contacts: readonly ContactListe[],
  coords: readonly CoordonneeLue[],
): Map<string, string> {
  const parContact = coordonneesParContact(coords);
  return new Map(contacts.map((contact) => [contact.id, villeListeContact(contact, parContact.get(contact.id) ?? [])]));
}

/** Lignes de l'index de recherche de tout l'annuaire, en une passe sur les coordonnées. */
export function lignesIndex(contacts: readonly ContactListe[], coords: readonly CoordonneeLue[]): LigneIndex[] {
  const parContact = coordonneesParContact(coords);
  return contacts.map((contact) => ligneIndexDe(contact, parContact.get(contact.id) ?? []));
}

export function ligneIndex(contact: ContactListe, coords: readonly CoordonneeLue[]): LigneIndex {
  return ligneIndexDe(
    contact,
    coords.filter((ligne) => ligne.contactId === contact.id),
  );
}

function ligneIndexDe(contact: ContactListe, siennes: readonly CoordonneeLue[]): LigneIndex {
  const emails = siennes
    .filter((ligne) => ligne.genre === "email")
    .map((ligne) => ligne.valeur.trim().toLocaleLowerCase("fr"));
  const telephones = siennes
    .filter((ligne) => ligne.genre === "telephone")
    .map((ligne) => ligne.valeur.replace(/\D/g, ""));
  const adresses = [
    contact.adresseDomicile,
    contact.adresseSiege,
    ...siennes.filter((ligne) => ligne.genre === "adresse").map((ligne) => ligne.valeur),
  ];
  const villes = adresses.map((adresse) => villeDepuisAdresse(adresse)).filter((ville) => ville !== "");
  const siren = (contact.siren ?? "").replace(/\D/g, "");
  const corps = [contact.prenoms, contact.nom, siren, ...emails, ...telephones, ...villes]
    .filter((part) => part !== null && part !== "")
    .join(" ");
  return { id: contact.id, corps };
}

/** Expression FTS5 en préfixe. `null` si la saisie est vide. */
export function expressionFts(saisie: string): string | null {
  const brut = saisie.trim();
  if (brut === "") return null;
  const chiffres = brut.replace(/\D/g, "");
  const sansChiffres = brut.replace(/[\d\s+().-]/g, "");
  if (chiffres.length >= 2 && sansChiffres === "") return `"${chiffres}"*`;
  const mots = brut
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr")
    .split(/[^a-z0-9@]+/)
    .filter((mot) => mot.length > 0);
  if (mots.length === 0) return null;
  return mots.map((mot) => `"${mot.replaceAll('"', "")}"*`).join(" AND ");
}

export const SQL_TABLE_FTS =
  "CREATE VIRTUAL TABLE annuaire_fts USING fts5(contact_id UNINDEXED, corps, tokenize = 'unicode61 remove_diacritics 2')";
