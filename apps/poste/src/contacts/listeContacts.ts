import { formatMontant } from "@/lib/format";

export type NatureContactListe = "physique" | "morale";

export type TypeClientListe = "professionnel" | "particulier" | "etranger";

export type AccordGrammatical = "masculin" | "feminin";

export type ProfessionReglementee =
  | "avocat"
  | "commissaire_justice"
  | "notaire"
  | "expert_judiciaire"
  | "administrateur_judiciaire"
  | "mandataire_judiciaire"
  | "expert_comptable"
  | "commissaire_comptes";

export type RepresentantFiche = {
  fonction: string;
  civilite: string;
  prenoms: string;
  nom: string;
  accord: AccordGrammatical;
};

export type ContactListe = {
  id: string;
  nature: NatureContactListe;
  nom: string;
  siren: string | null;
  numeroTva: string | null;
  typeClient: TypeClientListe;
  /** Vrai quand la fiche porte une profession réglementée. Absent des contacts déjà en base. */
  professionReglementee: boolean;
  civilite: string | null;
  accordSaisi: AccordGrammatical | null;
  prenoms: string | null;
  nomNaissance: string | null;
  dateNaissance: string | null;
  lieuNaissance: string | null;
  nationalite: string | null;
  profession: string | null;
  /** Code de situation familiale, ou null. */
  situationFamiliale: string | null;
  adresseDomicile: string | null;
  forme: string | null;
  /** Capital en centimes. Null si le montant n'est pas saisi. */
  capitalCentimes: number | null;
  monnaie: string | null;
  capitalLibelle: string | null;
  greffe: string | null;
  adresseSiege: string | null;
  activite: string | null;
  representant: RepresentantFiche | null;
  professionCode: ProfessionReglementee | null;
  barreau: string | null;
  toque: string | null;
  specialite: string | null;
  courAppel: string | null;
  /** Vrai quand la fiche est archivée : lisible, plus proposée à la saisie. */
  archivee?: boolean;
};

export function champsFicheVides(): Omit<
  ContactListe,
  "id" | "nature" | "nom" | "siren" | "numeroTva" | "typeClient" | "professionReglementee"
> {
  return {
    civilite: null,
    accordSaisi: null,
    prenoms: null,
    nomNaissance: null,
    dateNaissance: null,
    lieuNaissance: null,
    nationalite: null,
    profession: null,
    situationFamiliale: null,
    adresseDomicile: null,
    forme: null,
    capitalCentimes: null,
    monnaie: null,
    capitalLibelle: null,
    greffe: null,
    adresseSiege: null,
    activite: null,
    representant: null,
    professionCode: null,
    barreau: null,
    toque: null,
    specialite: null,
    courAppel: null,
  };
}

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

export function correspondRecherche(contact: ContactListe, recherche: string, corps = ""): boolean {
  const q = sansAccent(recherche.trim());
  if (q === "") return true;
  const qCompact = q.replace(/\s/g, "");
  const haystack = sansAccent([contact.prenoms, contact.nom, corps].filter((part) => part !== null && part !== "").join(" "));
  const compactHaystack = compact([contact.siren, contact.numeroTva, corps].filter((part) => part !== null).join(" "));
  return haystack.includes(q) || (qCompact !== "" && compactHaystack.includes(qCompact));
}

/** Fiches encore proposées quand on saisit un intervenant ou une partie. */
export function contactsProposables(contacts: readonly ContactListe[]): ContactListe[] {
  return contacts.filter((contact) => contact.archivee !== true);
}

export function filtrerContacts(
  contacts: readonly ContactListe[],
  filtre: FiltreContacts,
  recherche: string,
  corpsParId?: ReadonlyMap<string, string>,
): ContactListe[] {
  return contacts.filter(
    (contact) =>
      correspondFiltre(contact, filtre) &&
      correspondRecherche(contact, recherche, corpsParId?.get(contact.id) ?? ""),
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

export function libelleCapital(centimes: number, monnaie: string | null): string {
  if (monnaie !== null && monnaie !== "EUR") {
    const entier = Math.trunc(centimes / 100);
    const cent = Math.abs(centimes % 100);
    return `au capital de ${String(entier)},${String(cent).padStart(2, "0")} ${monnaie}`;
  }
  return `au capital de ${formatMontant(centimes)}`;
}

const PROFESSIONS: ReadonlySet<string> = new Set([
  "avocat",
  "commissaire_justice",
  "notaire",
  "expert_judiciaire",
  "administrateur_judiciaire",
  "mandataire_judiciaire",
  "expert_comptable",
  "commissaire_comptes",
]);

export function estProfessionReglementee(code: string | null): code is ProfessionReglementee {
  return code !== null && PROFESSIONS.has(code);
}

export type CoordonneeLue = {
  contactId: string;
  genre: string;
  usage: string;
  valeur: string;
  principale: boolean;
  creeLe: string;
  /** Pays saisi pour une adresse à l'étranger. Vide en France. */
  pays?: string | null;
};

/** Reprend l'adresse principale du domicile ou du siège, quand elle existe. */
export function appliquerCoordonnees(contacts: readonly ContactListe[], lignes: readonly CoordonneeLue[]): ContactListe[] {
  return contacts.map((contact) => {
    const domicile = adressePrincipale(lignes, contact.id, "domicile");
    const siege = adressePrincipale(lignes, contact.id, "siege");
    return {
      ...contact,
      adresseDomicile: domicile ?? contact.adresseDomicile,
      adresseSiege: siege ?? contact.adresseSiege,
    };
  });
}

function adressePrincipale(lignes: readonly CoordonneeLue[], contactId: string, usage: string): string | null {
  const trouvees = lignes.filter(
    (ligne) =>
      ligne.contactId === contactId &&
      ligne.genre === "adresse" &&
      ligne.usage === usage &&
      ligne.principale,
  );
  trouvees.sort((a, b) => b.creeLe.localeCompare(a.creeLe));
  const valeur = trouvees[0]?.valeur.trim() ?? "";
  return valeur === "" ? null : valeur;
}

export function libelleTypeClient(typeClient: TypeClientListe): string {
  if (typeClient === "professionnel") return "Professionnel";
  if (typeClient === "particulier") return "Particulier";
  return "Étranger";
}
