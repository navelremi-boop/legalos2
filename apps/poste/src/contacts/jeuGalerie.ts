import { champsFicheVides, type ContactListe } from "@/contacts/listeContacts";
import type { DossierFiche, FactureFiche, MailFiche, NoteFiche } from "@/contacts/historiqueFiche";

type FichePersonneDemo = Partial<ContactListe> & Pick<ContactListe, "id" | "nom">;

function personneDemo(fiche: FichePersonneDemo): ContactListe {
  return {
    nature: "physique",
    siren: null,
    numeroTva: null,
    typeClient: "particulier",
    professionReglementee: fiche.professionCode !== undefined && fiche.professionCode !== null,
    ...champsFicheVides(),
    nationalite: "française",
    ...fiche,
  };
}

function societeDemo(fiche: FichePersonneDemo & { capitalEuros: number | null }): ContactListe {
  const { capitalEuros, ...reste } = fiche;
  return {
    nature: "morale",
    siren: null,
    numeroTva: null,
    typeClient: "professionnel",
    professionReglementee: fiche.professionCode !== undefined && fiche.professionCode !== null,
    ...champsFicheVides(),
    capitalCentimes: capitalEuros === null ? null : capitalEuros * 100,
    monnaie: capitalEuros === null ? null : "EUR",
    capitalLibelle:
      capitalEuros === null ? null : `au capital de ${new Intl.NumberFormat("fr-FR").format(capitalEuros)} €`,
    ...reste,
  };
}

/** Jeu fictif de la maquette `prototype-contacts.html` (famille Ferrand et dossier 2026-031). */
export const CONTACTS_DEMO: ContactListe[] = [
  societeDemo({
    id: "ferrand",
    nom: "Ferrand Métal",
    forme: "5710",
    capitalEuros: 50_000,
    siren: "812345676",
    numeroTva: "FR19812345676",
    greffe: "RCS de Lyon",
    activite: "Métallurgie, fabrication de structures métalliques",
    adresseSiege: "14 rue de la Forge, 69007 Lyon",
    immatriculeLe: "2019-04-04",
    sourceImport: "recherche-entreprises",
    importeLe: "2026-10-02T09:00:00Z",
    sourceCapital: "le procès-verbal du 12 mars 2025",
  }),
  societeDemo({
    id: "ferrand-doublon",
    nom: "Ferrand Metal SAS",
    capitalEuros: null,
    siren: "812345676",
    adresseSiege: "14 rue de la Forge, 69007 Lyon",
  }),
  personneDemo({
    id: "antoine",
    nom: "Ferrand",
    civilite: "Monsieur",
    prenoms: "Antoine Louis",
    dateNaissance: "1972-02-03",
    lieuNaissance: "Saint-Étienne (Loire)",
    profession: "chef d'entreprise",
    situationFamiliale: "marie",
    adresseDomicile: "8 chemin des Vignes, 69290 Craponne",
  }),
  personneDemo({
    id: "claire",
    nom: "Ferrand",
    civilite: "Madame",
    prenoms: "Claire",
    nomNaissance: "Martin",
    dateNaissance: "1974-08-21",
    lieuNaissance: "Lyon (Rhône)",
    profession: "consultante",
    situationFamiliale: "marie",
    adresseDomicile: "8 chemin des Vignes, 69290 Craponne",
  }),
  personneDemo({
    id: "hugo",
    nom: "Ferrand",
    civilite: "Monsieur",
    prenoms: "Hugo",
    dateNaissance: "2001-05-12",
    lieuNaissance: "Lyon (Rhône)",
    situationFamiliale: "celibataire",
    adresseDomicile: "22 rue Chevreul, 69007 Lyon",
  }),
  societeDemo({
    id: "afp",
    nom: "AF Participations",
    forme: "5499",
    capitalEuros: 10_000,
    siren: "851902346",
    numeroTva: "FR35851902346",
    greffe: "RCS de Lyon",
    activite: "Activités des sociétés holding",
    adresseSiege: "8 chemin des Vignes, 69290 Craponne",
  }),
  societeDemo({
    id: "ferrandlog",
    nom: "Ferrand Logistique",
    forme: "5499",
    capitalEuros: 8_000,
    siren: "903417566",
    numeroTva: "FR57903417566",
    greffe: "RCS de Lyon",
    activite: "Transports routiers de fret",
    adresseSiege: "5 avenue de l'Industrie, 69800 Saint-Priest",
  }),
  societeDemo({
    id: "duclos",
    nom: "Duclos Industrie",
    forme: "5499",
    capitalEuros: 30_000,
    siren: "494012305",
    numeroTva: "FR20494012305",
    greffe: "RCS de Villefranche-Tarare",
    activite: "Commerce de gros de fournitures industrielles",
    adresseSiege: "120 rue de la République, 69400 Villefranche-sur-Saône",
  }),
  personneDemo({
    id: "perrin",
    nom: "Perrin",
    civilite: "Maître",
    accordSaisi: "feminin",
    prenoms: "Anne",
    professionCode: "avocat",
    barreau: "Lyon",
    toque: "1187",
    adresseDomicile: "18 quai de Bondy, 69005 Lyon",
  }),
  personneDemo({
    id: "vasseur",
    nom: "Vasseur",
    civilite: "Maître",
    accordSaisi: "masculin",
    prenoms: "Clément",
    professionCode: "avocat",
    barreau: "Lyon",
    toque: "874",
    adresseDomicile: "6 rue de la Bourse, 69002 Lyon",
  }),
  societeDemo({
    id: "banque",
    nom: "Banque Rhodanienne",
    forme: "5599",
    capitalEuros: 84_000_000,
    siren: "552100554",
    numeroTva: "FR96552100554",
    greffe: "RCS de Lyon",
    activite: "Autres intermédiations monétaires",
    adresseSiege: "2 place de la Bourse, 69002 Lyon",
  }),
  societeDemo({
    id: "rivegauche",
    nom: "Rive Gauche Expertise",
    forme: "5499",
    capitalEuros: 20_000,
    siren: "837650118",
    numeroTva: "FR78837650118",
    greffe: "RCS de Lyon",
    activite: "Activités comptables",
    professionCode: "expert_comptable",
    adresseSiege: "31 cours Gambetta, 69003 Lyon",
  }),
  personneDemo({
    id: "rambert",
    nom: "Rambert",
    civilite: "Maître",
    accordSaisi: "feminin",
    prenoms: "Julie",
    professionCode: "commissaire_justice",
    courAppel: "Lyon",
    adresseDomicile: "9 rue Servient, 69003 Lyon",
  }),
  personneDemo({
    id: "moreau",
    nom: "Moreau",
    civilite: "Madame",
    prenoms: "Hélène",
    nomNaissance: "Bouvier",
    dateNaissance: "1951-11-04",
    lieuNaissance: "Mâcon (Saône-et-Loire)",
    profession: "retraitée",
    situationFamiliale: "veuf",
    adresseDomicile: "3 allée des Cèdres, 69130 Écully",
  }),
  societeDemo({
    id: "perrache",
    nom: "Holding Perrache",
    forme: "5710",
    capitalEuros: 250_000,
    siren: "920118841",
    numeroTva: "FR84920118841",
    greffe: "RCS de Lyon",
    activite: "Activités des sociétés holding",
    adresseSiege: "11 cours de Verdun, 69002 Lyon",
  }),
  personneDemo({
    id: "operrache",
    nom: "Perrache",
    civilite: "Monsieur",
    prenoms: "Olivier",
    dateNaissance: "1968-06-17",
    lieuNaissance: "Grenoble (Isère)",
    profession: "dirigeant de société",
    situationFamiliale: "marie",
    adresseDomicile: "27 quai Saint-Antoine, 69002 Lyon",
  }),
];

export type HistoriqueGalerie = {
  contactId: string;
  dossiers: readonly DossierFiche[];
  factures: readonly FactureFiche[];
  mails: readonly MailFiche[];
  notes: readonly NoteFiche[];
};

const DOSSIER_FERRAND = { id: "dos-2026-031", nom: "SAS Ferrand Métal c/ SARL Duclos Industrie" };
const DOSSIER_TILLEULS = { id: "dos-2026-042", nom: "SCI Les Tilleuls c/ Banque Rhodanienne" };
const DOSSIER_MOREAU = { id: "dos-2026-057", nom: "Succession Moreau" };
const DOSSIER_PERRACHE = { id: "dos-2026-021", nom: "Holding Perrache, restructuration" };

/** Fiche dont l'historique ne contient qu'un dossier (jeu de la maquette `prototype-contacts.html`). */
function unDossier(
  contactId: string,
  dossier: { id: string; nom: string },
  qualite: string,
): HistoriqueGalerie {
  return { contactId, dossiers: [{ ...dossier, qualite }], factures: [], mails: [], notes: [] };
}

/** Historique figé de la galerie, par fiche. Une fiche absente n'a aucun dossier. */
export const HISTORIQUES_GALERIE: readonly HistoriqueGalerie[] = [
  {
    contactId: "antoine",
    dossiers: [{ ...DOSSIER_FERRAND, qualite: "représentant légal, rattaché à SAS Ferrand Métal" }],
    factures: [],
    mails: [
      { id: "mail-antoine-1", objet: "Re: Assignation Duclos, pièces complémentaires", expediteur: "cabinet@example.test", destinataires: "a.ferrand@ferrand-metal.example", etat: "classe" },
    ],
    notes: [],
  },
  {
    contactId: "ferrand",
    dossiers: [{ ...DOSSIER_FERRAND, qualite: "client, demandeur" }],
    factures: [
      { id: "fac-2026-0131", libelle: "Provision sur honoraires", ttcCentimes: 240_000, encaisseCentimes: 240_000 },
      { id: "fac-2026-0158", libelle: "Honoraires, mise en état", ttcCentimes: 360_000, encaisseCentimes: 0 },
    ],
    mails: [
      { id: "mail-ferrand-1", objet: "Re: Assignation Duclos, pièces complémentaires", expediteur: "a.ferrand@ferrand-metal.example", destinataires: "cabinet@example.test", etat: "classe" },
      { id: "mail-ferrand-2", objet: "Factures fournisseurs Duclos 2025", expediteur: "compta@ferrand-metal.example", destinataires: "cabinet@example.test", etat: "classe" },
      { id: "mail-ferrand-3", objet: "Convocation à l'audience du 6 novembre", expediteur: "cabinet@example.test", destinataires: "direction@ferrand-metal.example", etat: "classe" },
    ],
    notes: [
      { id: "note-ferrand-1", texte: "Interlocuteur habituel : M. Antoine Ferrand, joignable de préférence le matin." },
      { id: "note-ferrand-2", texte: "Comptabilité tenue par Rive Gauche Expertise ; les relances de factures partent en copie à compta@ferrand-metal.example." },
    ],
  },
  unDossier("duclos", DOSSIER_FERRAND, "adversaire, défendeur"),
  unDossier("perrin", DOSSIER_FERRAND, "avocate de SARL Duclos Industrie"),
  unDossier("vasseur", DOSSIER_TILLEULS, "avocat de Banque Rhodanienne"),
  unDossier("banque", DOSSIER_TILLEULS, "adversaire, intimée"),
  unDossier("rambert", DOSSIER_FERRAND, "commissaire de justice"),
  unDossier("moreau", DOSSIER_MOREAU, "cliente, héritière"),
  unDossier("perrache", DOSSIER_PERRACHE, "client"),
  unDossier("operrache", DOSSIER_PERRACHE, "représentant légal, rattaché à Holding Perrache"),
];

/** Nombre de dossiers affiché dans la liste, figé pour la galerie. Une fiche absente en a zéro. */
export const COMPTES_DOSSIERS_GALERIE: Readonly<Record<string, number>> = {
  ferrand: 1,
  antoine: 1,
  duclos: 1,
  perrin: 1,
  vasseur: 1,
  banque: 1,
  rambert: 1,
  moreau: 1,
  perrache: 1,
  operrache: 1,
};

export type IncoherenceGalerie = {
  contactId: string;
  /** Nombre de dossiers affiché dans la liste. */
  liste: number;
  /** Nombre de dossiers de l'onglet Dossiers, qui est aussi celui de son compteur. */
  onglet: number;
};

/**
 * Contrôle de cohérence de la galerie : pour chaque fiche, le nombre de dossiers de la liste égale
 * celui de l'onglet Dossiers, compteur compris : l'écran Contacts tire les deux de la longueur de
 * l'historique de la fiche (`compteursOnglets.dossiers` et liste de l'onglet).
 */
export function incoherencesGalerie(
  contacts: readonly { id: string }[],
  comptes: Readonly<Record<string, number>>,
  historiques: readonly HistoriqueGalerie[],
): IncoherenceGalerie[] {
  const resultat: IncoherenceGalerie[] = [];
  for (const contact of contacts) {
    const liste = comptes[contact.id] ?? 0;
    const historique = historiques.find((fixe) => fixe.contactId === contact.id);
    const onglet = historique?.dossiers.length ?? 0;
    if (liste !== onglet) resultat.push({ contactId: contact.id, liste, onglet });
  }
  return resultat;
}
