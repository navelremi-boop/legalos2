export type NatureContactListe = "physique" | "morale";

export type TypeClientListe = "professionnel" | "particulier" | "etranger";

export type ContactListe = {
  id: string;
  nature: NatureContactListe;
  nom: string;
  siren: string | null;
  numeroTva: string | null;
  typeClient: TypeClientListe;
  /** Vrai quand la fiche porte une profession réglementée. Absent des contacts déjà en base. */
  professionReglementee: boolean;
};

export type FiltreContacts = "tous" | "personnes" | "societes" | "professions";

export const FILTRES_CONTACTS: { id: FiltreContacts; label: string }[] = [
  { id: "tous", label: "Tous" },
  { id: "personnes", label: "Personnes" },
  { id: "societes", label: "Sociétés" },
  { id: "professions", label: "Professions" },
];

export type OngletFicheContact = "general" | "liens" | "dossiers" | "factures" | "mails" | "notes";

export const ONGLETS_FICHE: { id: OngletFicheContact; label: string }[] = [
  { id: "general", label: "Général" },
  { id: "liens", label: "Liens" },
  { id: "dossiers", label: "Dossiers" },
  { id: "factures", label: "Factures" },
  { id: "mails", label: "Mails" },
  { id: "notes", label: "Notes" },
];

export function correspondFiltre(contact: ContactListe, filtre: FiltreContacts): boolean {
  if (filtre === "tous") return true;
  if (filtre === "personnes") return contact.nature === "physique";
  if (filtre === "societes") return contact.nature === "morale";
  return contact.professionReglementee;
}

function sansAccent(valeur: string): string {
  return valeur.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

function compact(valeur: string): string {
  return sansAccent(valeur).replace(/\s/g, "");
}

export function correspondRecherche(contact: ContactListe, recherche: string): boolean {
  const q = sansAccent(recherche.trim());
  if (q === "") return true;
  const qCompact = q.replace(/\s/g, "");
  return (
    sansAccent(contact.nom).includes(q) ||
    compact(contact.siren ?? "").includes(qCompact) ||
    compact(contact.numeroTva ?? "").includes(qCompact)
  );
}

export function filtrerContacts(
  contacts: readonly ContactListe[],
  filtre: FiltreContacts,
  recherche: string,
): ContactListe[] {
  return contacts.filter(
    (contact) => correspondFiltre(contact, filtre) && correspondRecherche(contact, recherche),
  );
}

export type GroupeContacts = { lettre: string; contacts: ContactListe[] };

export function grouperAlphabetique(contacts: readonly ContactListe[]): GroupeContacts[] {
  const tries = [...contacts].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  const groupes: GroupeContacts[] = [];
  for (const contact of tries) {
    const brut = contact.nom.trim().charAt(0);
    const lettre = brut === "" ? "#" : brut.toLocaleUpperCase("fr");
    const dernier = groupes.at(-1);
    if (dernier !== undefined && dernier.lettre === lettre) dernier.contacts.push(contact);
    else groupes.push({ lettre, contacts: [contact] });
  }
  return groupes;
}

export function compteursFiltres(contacts: readonly ContactListe[]): Record<FiltreContacts, number> {
  return {
    tous: contacts.length,
    personnes: contacts.filter((contact) => contact.nature === "physique").length,
    societes: contacts.filter((contact) => contact.nature === "morale").length,
    professions: contacts.filter((contact) => contact.professionReglementee).length,
  };
}

export function libelleNature(nature: NatureContactListe): string {
  return nature === "physique" ? "Personne physique" : "Personne morale";
}

export function libelleTypeClient(typeClient: TypeClientListe): string {
  if (typeClient === "professionnel") return "Professionnel";
  if (typeClient === "particulier") return "Particulier";
  return "Étranger";
}
