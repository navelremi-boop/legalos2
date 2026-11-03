import { useEffect, useMemo, useState } from "react";
import { BarreHaut } from "@/coque/BarreHaut";
import { MenuCompte } from "@/coque/MenuCompte";
import { CHRONO_DEMO } from "@/coque/chrono/donneesDemo";
import { DossierOuvert, DOSSIERS_DEMO } from "@/screens/DossierOuvert";
import { EcranAgenda } from "@/agenda/EcranAgenda";
import { instantPourHeureParis } from "@/agenda/fuseauParis";
import { decalerJour, jourCivil } from "@/agenda/navigationAgenda";
import { EcranFacturation } from "@/facturation/EcranFacturation";
import { EcranTemps } from "@/screens/EcranTemps";
import { htTempsCentimes } from "@/facturation/ecrireTemps";
import type { EtatChrono } from "@/facturation/chronoTemps";
import { estAClasser } from "@/messagerie/classement";
import { EcranMails, type DemonstrationMails } from "@/messagerie/EcranMails";
import type { InvitationLocale } from "@/messagerie/typesMails";
import type { DemonstrationMessagerie } from "@/messagerie/ReglagesMessagerie";
import { Dossiers } from "@/screens/Dossiers";
import type { IntervenantAffiche } from "@/contacts/intervenants";
import { Contacts } from "@/screens/Contacts";
import {
  champsFicheVides,
  libelleListeContact,
  type ContactListe,
  type CoordonneeLue,
} from "@/contacts/listeContacts";
import type { LienAffiche } from "@/contacts/liensContacts";
import { Journee } from "@/screens/Journee";
import { EcranConnexion } from "@/onboarding/EcranConnexion";
import {
  ETATS_CONNEXION,
  LIBELLES_ETAT_CONNEXION,
  type EtatConnexion,
} from "@/onboarding/etatsConnexion";
import { QUALITES_LIVREES } from "@/contacts/intervenants";
import { Reglages } from "@/screens/Reglages";
import type { ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";

const INTERVENANTS_DEMO: IntervenantAffiche[] = [
  {
    id: "societe",
    codeQualite: "client",
    libelleQualite: "client",
    prenoms: null,
    nom: "SARL Duclos Industrie",
    accord: null,
    rattacheA: null,
  },
  {
    id: "anne",
    codeQualite: "avocat",
    libelleQualite: "avocat",
    prenoms: "Anne",
    nom: "Perrin",
    accord: "feminin",
    rattacheA: "societe",
  },
];

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
const CONTACTS_DEMO: ContactListe[] = [
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

type LienDemo = Omit<LienAffiche, "id" | "sourceCivilite" | "sourcePrenoms" | "sourceNom" | "cibleNom">;

function lienDemo(lien: LienDemo): LienAffiche {
  const source = CONTACTS_DEMO.find((contact) => contact.id === lien.sourceId);
  const cible = CONTACTS_DEMO.find((contact) => contact.id === lien.cibleId);
  return {
    id: `lien-${lien.sourceId}-${lien.cibleId}-${lien.fonction ?? lien.typeLien}`,
    sourceCivilite: source?.civilite ?? null,
    sourcePrenoms: source?.prenoms ?? null,
    sourceNom: source === undefined ? "" : libelleListeContact({ ...source, prenoms: null, civilite: null }),
    cibleNom: cible === undefined ? "" : libelleListeContact(cible),
    ...lien,
  };
}

const mandat = (sourceId: string, cibleId: string, fonction: string, debut: string, fin: string | null = null) =>
  lienDemo({ sourceId, cibleId, typeLien: "mandat_social", fonction, libelle: null, representeSociete: fin === null, debut, fin });
const lienSimple = (sourceId: string, cibleId: string, typeLien: string) =>
  lienDemo({ sourceId, cibleId, typeLien, fonction: null, libelle: null, representeSociete: false, debut: null, fin: null });

const LIENS_CONTACTS_DEMO: LienAffiche[] = [
  { ...mandat("antoine", "ferrand", "president", "2019-04-04"), source: "Kbis du 2 octobre 2026" },
  { ...mandat("claire", "ferrand", "directeur_general", "2019-04-04", "2025-03-12"), source: "Procès-verbal du 12 mars 2025" },
  { ...mandat("antoine", "afp", "gerant", "2025-01-18"), source: "Statuts constitutifs" },
  { ...mandat("antoine", "ferrandlog", "gerant", "2021-09-02"), source: "Kbis du 2 octobre 2026" },
  mandat("operrache", "perrache", "president", "2022-07-01"),
  { ...lienSimple("rivegauche", "ferrand", "expert_comptable"), source: "Lettre de mission" },
  lienSimple("antoine", "claire", "conjoint_pacs"),
  lienSimple("antoine", "hugo", "parent"),
  lienSimple("claire", "hugo", "parent"),
];

const COORDONNEES_CONTACTS_DEMO: CoordonneeLue[] = [
  ["ferrand", "adresse", "siege", "14 rue de la Forge, 69007 Lyon", true],
  ["ferrand", "adresse", "facturation", "BP 3021, 69341 Lyon Cedex 07", true],
  ["ferrand", "telephone", "autre", "04 72 00 41 18", true],
  ["ferrand", "email", "autre", "direction@ferrand-metal.example", true],
  ["ferrand", "email", "autre", "compta@ferrand-metal.example", false],
  ["antoine", "adresse", "domicile", "8 chemin des Vignes, 69290 Craponne", true],
  ["antoine", "telephone", "autre", "06 71 22 40 93", true],
  ["antoine", "email", "autre", "a.ferrand@ferrand-metal.example", true],
  ["perrin", "adresse", "cabinet", "18 quai de Bondy, 69005 Lyon", true],
  ["perrin", "telephone", "autre", "04 78 37 52 10", true],
  ["perrin", "email", "autre", "a.perrin@perrin-avocats.example", true],
].map(([contactId, genre, usage, valeur, principale]) => ({
  contactId: String(contactId),
  genre: String(genre),
  usage: String(usage),
  valeur: String(valeur),
  principale: principale === true,
  creeLe: "2026-10-02T09:00:00Z",
}));

function jourDans(jours: number): string {
  return decalerJour(jourCivil(new Date()), jours);
}

/** Données fictives de la rubrique Messagerie des réglages (signature et modèles, sans appel à l'API). */
const messagerieDemo: DemonstrationMessagerie = {
  comptes: [
    { id: "demo-compte-perso", adresse: "j.marchal@cabinet-marchal.example", typeCompte: "nominatif" },
    { id: "demo-compte-cabinet", adresse: "contact@cabinet-marchal.example", typeCompte: "classement" },
  ],
  signatures: {
    "demo-compte-perso":
      "<p><strong>Julien Marchal</strong><br>Avocat au Barreau de Lyon<br>Cabinet Marchal, 14 quai de la Pêcherie, 69001 Lyon<br>04 00 00 00 00</p>",
    "demo-compte-cabinet": "<p>Cabinet Marchal<br>14 quai de la Pêcherie, 69001 Lyon</p>",
  },
  sante: {
    comptes: [
      {
        compteId: "demo-compte-perso",
        adresse: "j.marchal@cabinet-marchal.example",
        typeCompte: "nominatif",
        etatConnexion: "connecte",
        derniereReleveLe: "2026-10-12T08:59:00Z",
        retardSecondes: 60,
        erreursAuthentification: 0,
        derniereErreurAuthentificationLe: null,
        envoisEnEchec: 0,
        alerte: false,
        motifs: [],
        oauth: false,
        fournisseur: null,
        corpsIndexes: 1240,
        corpsRestants: 310,
        corpsAbandonnes: 0,
      },
      {
        compteId: "demo-compte-partage",
        adresse: "contact@cabinet-marchal.example",
        typeCompte: "partage",
        etatConnexion: "connecte",
        derniereReleveLe: "2026-10-12T08:59:00Z",
        retardSecondes: 60,
        erreursAuthentification: 0,
        derniereErreurAuthentificationLe: null,
        envoisEnEchec: 0,
        alerte: false,
        motifs: [],
        oauth: false,
        fournisseur: null,
        corpsIndexes: 860,
        corpsRestants: 0,
        corpsAbandonnes: 2,
      },
      {
        compteId: "demo-compte-roux",
        adresse: "c.roux@cabinet-marchal.example",
        typeCompte: "nominatif",
        etatConnexion: "identifiants_refuses",
        derniereReleveLe: "2026-10-11T18:00:00Z",
        retardSecondes: 54_000,
        erreursAuthentification: 4,
        derniereErreurAuthentificationLe: "2026-10-12T06:12:00Z",
        envoisEnEchec: 0,
        alerte: true,
        motifs: ["identifiants_refuses"],
        oauth: false,
        fournisseur: null,
        corpsIndexes: 0,
        corpsRestants: 0,
        corpsAbandonnes: 0,
      },
      {
        compteId: "demo-compte-garnier",
        adresse: "a.garnier@cabinet-marchal.example",
        typeCompte: "nominatif",
        etatConnexion: "connecte",
        derniereReleveLe: "2026-10-12T08:58:00Z",
        retardSecondes: 120,
        erreursAuthentification: 0,
        derniereErreurAuthentificationLe: null,
        envoisEnEchec: 0,
        alerte: false,
        motifs: [],
        oauth: true,
        fournisseur: "microsoft",
        corpsIndexes: 0,
        corpsRestants: 0,
        corpsAbandonnes: 0,
      },
      {
        compteId: "demo-compte-lefort",
        adresse: "m.lefort@cabinet-marchal.example",
        typeCompte: "nominatif",
        etatConnexion: "identifiants_refuses",
        derniereReleveLe: "2026-10-11T17:30:00Z",
        retardSecondes: 55_000,
        erreursAuthentification: 3,
        derniereErreurAuthentificationLe: "2026-10-12T06:40:00Z",
        envoisEnEchec: 0,
        alerte: true,
        motifs: ["identifiants_refuses"],
        oauth: true,
        fournisseur: "gmail",
        corpsIndexes: 0,
        corpsRestants: 0,
        corpsAbandonnes: 0,
      },
    ],
    envoisEnEchec: 0,
    alerte: true,
  },
  modeles: [
    {
      id: "demo-modele-1",
      nom: "Accusé de réception de pièces",
      objet: "Accusé de réception de vos pièces",
      corpsHtml: "<p>Maître,</p><p>Nous accusons réception de vos pièces.</p>",
    },
    { id: "demo-modele-2", nom: "Demande de pièces au client", objet: "", corpsHtml: "<p>Madame, Monsieur,</p>" },
    { id: "demo-modele-3", nom: "Relance de provision", objet: "Provision sur honoraires", corpsHtml: "<p>Bonjour,</p>" },
  ],
};

/**
 * Galerie de démonstration — réservée au développement (`import.meta.env.DEV`).
 * Absente des builds distribués. Inclut la barre du haut pour comparer au prototype.
 */
export function GalerieDemo() {
  /** `&plein=1` : la scène occupe toute la fenêtre (captures à 1366, 1920 et 2560 px), les commandes passent dessous. */
  const plein = new URLSearchParams(window.location.search).has("plein");
  useEffect(() => {
    if (!plein) return;
    document.documentElement.classList.add("galerie-plein");
    return () => {
      document.documentElement.classList.remove("galerie-plein");
    };
  }, [plein]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [chemise, setChemise] = useState<ChemiseId>("kraft");
  /** Dernière entrée choisie dans le menu du compte (la galerie n'exécute rien), lue par les recettes. */
  const [dernierChoixCompte, setDernierChoixCompte] = useState("");
  const [vue, setVue] = useState<
    | "dossier"
    | "journee"
    | "dossiers"
    | "contacts"
    | "mails"
    | "agenda"
    | "facturation"
    | "reglages"
    | "temps"
    | "connexion"
  >("dossier");
  const [etatConnexion, setEtatConnexion] = useState<EtatConnexion>("adresse");
  const [chronoTemps, setChronoTemps] = useState<EtatChrono>({
    phase: "pause",
    secondes: 12 * 60 + 4,
    dossierId: "ferrand",
    libelle: "Préparation",
  });
  const tempsDemo = useMemo(() => {
    const aujourd = new Date().toISOString().slice(0, 10);
    const hier = decalerJour(aujourd, -1);
    const taux = 6_000;
    return [
      {
        id: "t1",
        jour: aujourd,
        minutes: 45,
        libelle: "Préparation audience",
        dossierId: "ferrand",
        dossierNom: "Ferrand Métal",
        reference: "2026-042",
        chemise: "kraft" as const,
        intervenantId: "demo-moi",
        intervenantNom: "Me Julien Marchal",
        tauxCentimesHeure: taux,
        htCentimes: htTempsCentimes(45, taux),
        facturee: false,
      },
      {
        id: "t2",
        jour: hier,
        minutes: 60,
        libelle: "Entretien téléphonique",
        dossierId: "lilas",
        dossierNom: "SCI des Lilas",
        reference: "2026-038",
        chemise: "vert-amande" as const,
        intervenantId: "autre",
        intervenantNom: "Me Camille Roux",
        tauxCentimesHeure: taux,
        htCentimes: htTempsCentimes(60, taux),
        facturee: true,
      },
    ];
  }, []);

  const mailsDemo = useMemo<DemonstrationMails>(() => {
    // Jeu fictif de la maquette prototype-mails, daté d'après un instant fixe pour des captures stables.
    const moi = "demo-utilisateur";
    const boite = "j.marchal@cabinet-marchal.example";
    return {
      maintenant: "2026-10-09T10:00:00+02:00",
      derniereReleve: "2026-10-09T09:59:00+02:00",
      selectionInitiale: "mail-2",
      comptes: [
        { id: "compte-perso", adresse: boite, type_compte: "nominatif", titulaire_id: moi },
        { id: "compte-partage", adresse: "contact@cabinet-marchal.example", type_compte: "partage" },
      ],
      dossiers: [
        { id: "d-tilleuls", nom: "SCI Les Tilleuls", chemise: "jaune-paille", reference: "2026-044" },
        { id: "d-ferrand", nom: "Ferrand Métal", chemise: "kraft", reference: "2026-042" },
        { id: "d-moreau", nom: "Succession Moreau", chemise: "lilas", reference: "2026-057" },
      ],
      file: [
        {
          id: "envoi-1",
          objet: "Conclusions en réplique",
          destinataire: "Me Anne Perrin",
          etat: "copie_envoyes_confirmee",
        },
        {
          id: "envoi-2",
          objet: "Bordereau de pièces",
          destinataire: "Me Lucas Garnier",
          etat: "en_attente",
        },
      ],
      invitations: [
        {
          id: "invitation-1",
          uid_ical: "demo-acte-partage@etude-garnier.example",
          sequence: 0,
          effet: "demande",
          fuseau: "Europe/Paris",
          debut: "2026-10-08T10:00:00",
          fin: "2026-10-08T11:00:00",
          objet: "Signature de l'acte de partage",
          organisateur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
        },
      ],
      corps: {
        "mail-1":
          "Cher Confrère,\n\nJe vous prie de bien vouloir trouver ci-joint communication des pièces n° 14 à 19, dont le bordereau récapitulatif est joint au présent envoi.\n\nBien confraternellement.\n\nClément Vasseur\nAvocat au Barreau de Lyon",
        "mail-2":
          "Maître,\n\nL'affaire enregistrée sous le numéro RG 25/04417 est fixée à l'audience de mise en état du 12 novembre à 9 h 30.\n\nLe greffe",
        "mail-3":
          "Maître,\n\nVoici les deux derniers bons de livraison que vous m'aviez demandés pour l'audience de lundi.\n\nBien cordialement.\n\nInès Ferrand\nDirectrice administrative, SAS Ferrand Métal",
        "mail-4":
          "Maître,\n\nJe vous propose de fixer la signature de l'acte de partage de la succession Moreau au jeudi 8 octobre à 10 h, en présence de Mme Moreau.\n\nBien à vous.",
        "mail-5":
          "Maître,\n\nFaisant suite à nos échanges, nous vous adressons une proposition de protocole d'accord, que nous vous remercions de soumettre à votre cliente.\n\nLe service contentieux",
        "mail-6":
          "Mes chers Confrères,\n\nVous trouverez dans cette lettre le programme de formation continue du trimestre et le calendrier des permanences.",
        "mail-7":
          "Mon cher Confrère,\n\nJe vous prie de trouver ci-joint mes conclusions récapitulatives, notifiées ce jour par RPVA.\n\nBien confraternellement.",
      },
      mails: [
        {
          id: "mail-1",
          objet: "Communication de pièces adverses n° 14 à 19",
          expediteur: "Me Clément Vasseur <c.vasseur@cabinet-vasseur.example>",
          destinataires_texte: boite,
          pieces_texte: "Bordereau n° 4.pdf\nPièce 14, contrat de prêt.pdf\nPièce 15, avenant.pdf",
          debut_texte: "Cher Confrère, je vous prie de bien vouloir trouver ci-joint communication des pièces…",
          etat_classement: "classe",
          dossier_id: "d-tilleuls",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 0,
          dossier_imap: "INBOX",
          cree_le: "2026-10-09T09:12:00+02:00",
        },
        {
          id: "mail-2",
          objet: "Avis de fixation, RG 25/04417",
          expediteur: "Greffe de la cour d'appel de Lyon <greffe.ca-lyon@justice.example>",
          destinataires_texte: boite,
          pieces_texte: "Avis de fixation.pdf",
          debut_texte: "L'affaire est fixée à l'audience de mise en état du 12 novembre à 9 h 30…",
          etat_classement: "suggestion",
          dossier_id: null,
          suggestion_dossier_id: "d-tilleuls",
          titulaire_id: moi,
          lu: 0,
          dossier_imap: "INBOX",
          cree_le: "2026-10-09T08:40:00+02:00",
        },
        {
          id: "mail-3",
          objet: "Re : dossier de plaidoirie",
          expediteur: "Mme Inès Ferrand <i.ferrand@ferrand-metal.example>",
          destinataires_texte: boite,
          pieces_texte: "Bon de livraison 1184.pdf\nBon de livraison 1192.pdf",
          debut_texte: "Maître, voici les deux derniers bons de livraison que vous m'aviez demandés…",
          etat_classement: "classe",
          dossier_id: "d-ferrand",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-09T08:05:00+02:00",
        },
        {
          id: "mail-4",
          objet: "Invitation : signature de l'acte de partage",
          expediteur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
          destinataires_texte: boite,
          pieces_texte: "",
          debut_texte: "Rendez-vous le jeudi 8 octobre, 10 h à 11 h, à l'étude. Merci de confirmer votre présence.",
          etat_classement: "classe",
          dossier_id: "d-moreau",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-08T17:20:00+02:00",
        },
        {
          id: "mail-5",
          objet: "Proposition de protocole d'accord",
          expediteur: "Banque Rhodanienne, service contentieux <contentieux@banque-rhodanienne.example>",
          destinataires_texte: boite,
          pieces_texte: "Projet de protocole.docx",
          debut_texte: "Maître, faisant suite à nos échanges, nous vous adressons une proposition de protocole…",
          etat_classement: "suggestion",
          dossier_id: null,
          suggestion_dossier_id: "d-tilleuls",
          titulaire_id: moi,
          lu: 0,
          dossier_imap: "INBOX",
          cree_le: "2026-10-08T11:02:00+02:00",
        },
        {
          id: "mail-6",
          objet: "Lettre d'information d'octobre",
          expediteur: "Ordre des avocats de Lyon <communication@barreau-lyon.example>",
          destinataires_texte: "contact@cabinet-marchal.example",
          pieces_texte: "",
          debut_texte: "Formation continue, permanences et calendrier des audiences solennelles…",
          etat_classement: "a_classer",
          dossier_id: null,
          suggestion_dossier_id: null,
          titulaire_id: null,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-05T07:30:00+02:00",
        },
        {
          id: "mail-7",
          objet: "Conclusions récapitulatives",
          expediteur: "Me Anne Perrin <a.perrin@perrin-avocats.example>",
          destinataires_texte: boite,
          pieces_texte: "Conclusions récapitulatives.pdf",
          debut_texte: "Mon cher Confrère, je vous prie de trouver ci-joint mes conclusions récapitulatives…",
          etat_classement: "classe",
          dossier_id: "d-ferrand",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-01T18:42:00+02:00",
        },
        {
          id: "mail-8",
          objet: "Réponse à la proposition de protocole",
          expediteur: boite,
          destinataires_texte: "Banque Rhodanienne, service contentieux <contentieux@banque-rhodanienne.example>",
          pieces_texte: "",
          debut_texte: "Madame, Monsieur, ma cliente accepte le principe d'une transaction…",
          etat_classement: "classe",
          dossier_id: "d-tilleuls",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "Drafts",
          cree_le: "2026-10-09T09:31:00+02:00",
        },
      ],
    };
  }, []);
  const aClasser = mailsDemo.mails.filter((mail) => estAClasser(mail.etat_classement)).length;
  const dossiersDemo = useMemo(
    () => [
      {
        id: "ferrand",
        nom: "Ferrand Métal",
        chemise: "kraft",
        reference: "2026-042",
        type_dossier: "contentieux",
        etape: "instruction",
        echeance_titre: "Conclusions en réplique",
        echeance_debut: jourDans(5),
        non_lus: 2,
        parties: [
          { role: "client", nom: "SAS Ferrand Métal" },
          { role: "adversaire", nom: "SARL Dupuis Outillage" },
        ],
      },
      {
        id: "martin",
        nom: "Martin c/ Assurances Loire",
        chemise: "bleu-classeur",
        reference: "2026-031",
        type_dossier: "contentieux",
        etape: "plaidoirie",
        echeance_titre: "Appel incident",
        echeance_debut: jourDans(2),
        non_lus: 1,
        parties: [
          { role: "client", nom: "M. Paul Martin" },
          { role: "adversaire", nom: "SA Assurances Loire" },
        ],
      },
      {
        id: "moreau",
        nom: "Succession Moreau",
        chemise: "lilas",
        reference: "2026-057",
        type_dossier: "conseil",
        etape: "instruction",
        echeance_titre: "Projet d'acte de partage",
        echeance_debut: jourDans(8),
        parties: [{ role: "client", nom: "Mme Claire Moreau" }],
      },
      {
        id: "lilas",
        nom: "SCI des Lilas",
        chemise: "vert-amande",
        reference: "2026-038",
        type_dossier: "conseil",
        etape: "ouverture",
      },
      {
        id: "tilleuls",
        nom: "SCI Les Tilleuls",
        chemise: "jaune-paille",
        reference: "2026-044",
        type_dossier: "contentieux",
        etape: "jugement",
        echeance_titre: "Signification du jugement",
        echeance_debut: jourDans(23),
      },
    ],
    [],
  );
  const agendaDemo = useMemo(() => {
    const base = new Date();
    const iso = (heure: number) => {
      const copie = new Date(base);
      copie.setHours(heure, 0, 0, 0);
      const mois = String(copie.getMonth() + 1).padStart(2, "0");
      const jour = String(copie.getDate()).padStart(2, "0");
      return `${String(copie.getFullYear())}-${mois}-${jour}T${String(heure).padStart(2, "0")}:00:00`;
    };
    return [
      {
        id: "ag-1",
        dossier_id: "ferrand",
        type_element: "audience",
        titre: "Mise en état",
        debut: iso(9),
        rappel_le: "1 heure avant",
        dossier_nom: "Ferrand Métal",
        dossier_reference: "2026-042",
        dossier_chemise: "kraft",
        origine_calcul: null,
        jours_calcul: null,
        mois_calcul: null,
        annees_calcul: null,
      },
      {
        id: "ag-2",
        dossier_id: "lilas",
        type_element: "rendez_vous",
        titre: "Rendez-vous client",
        debut: iso(14),
        rappel_le: null,
        origine_calcul: null,
        jours_calcul: null,
        mois_calcul: null,
        annees_calcul: null,
      },
      {
        id: "ag-3",
        dossier_id: "ferrand",
        type_element: "tache",
        titre: "Déposer les conclusions",
        debut: iso(16),
        rappel_le: null,
        origine_calcul: "2026-09-01",
        jours_calcul: 15,
        mois_calcul: 0,
        annees_calcul: 0,
      },
    ];
  }, []);
  /** Invitations reçues, aujourd'hui : acceptée, mise à jour à laquelle il reste à répondre, annulée. */
  const invitationsAgendaDemo = useMemo<InvitationLocale[]>(() => {
    const jour = jourCivil(new Date());
    const invitation = (
      id: string,
      heure: number,
      minute: number,
      extra: Partial<InvitationLocale>,
    ): InvitationLocale => {
      const mur = (h: number, m: number) => `${jour}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
      return {
        id,
        uid_ical: `demo-${id}`,
        sequence: 0,
        effet: "demande",
        fuseau: "Europe/Paris",
        debut: mur(heure, minute),
        fin: mur(heure + 1, minute),
        debut_utc: instantPourHeureParis(jour, heure, minute),
        fin_utc: instantPourHeureParis(jour, heure + 1, minute),
        objet: "",
        organisateur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
        verifiee: 1,
        message_id: `<demo-${id}@etude-garnier.example>`,
        reponse: null,
        ...extra,
      };
    };
    return [
      invitation("inv-1", 11, 0, { objet: "Signature de l'acte de partage", reponse: "accepte" }),
      invitation("inv-2", 12, 30, { objet: "Point sur la cession", sequence: 1, effet: "mise_a_jour" }),
      invitation("inv-3", 17, 0, { objet: "Réunion de synthèse", sequence: 1, effet: "annulation" }),
    ];
  }, []);
  const facturesDemo = useMemo(
    () => [
      { id: "f-brouillon", libelle: "Ferrand Métal — temps de septembre", statut: "Brouillon", montant: "1 200,00 €" },
      { id: "f-validee", libelle: "SCI des Lilas — provision", statut: "Validée", montant: "800,00 €" },
      { id: "f-deposee", libelle: "Ferrand Métal — facture 2026-014", statut: "Déposée", montant: "2 400,00 €" },
      { id: "f-encaissee", libelle: "SCI des Lilas — facture 2026-011", statut: "Encaissée", montant: "600,00 €" },
      { id: "f-avoir", libelle: "Avoir sur 2026-011", statut: "Avoir", montant: "−120,00 €" },
    ],
    [],
  );

  const premier = DOSSIERS_DEMO[0];
  const dossier =
    DOSSIERS_DEMO.find((d) => d.chemise === chemise) ??
    (premier === undefined
      ? {
          id: "demo",
          reference: "2026-042",
          nom: "Ferrand Métal",
          chemise,
          juridiction: "Tribunal judiciaire de Nanterre",
          numeroRg: "24/03812",
          client: "SAS Ferrand Métal",
          adversaire: "Sté Dupuis Outillage",
        }
      : { ...premier, chemise });

  const onglets = useMemo(
    () =>
      DOSSIERS_DEMO.map((d) => ({
        id: d.id,
        reference: d.reference,
        nom: d.nom,
        chemise: d.chemise,
      })),
    [],
  );

  return (
    <div className={plein ? "flex flex-col bg-page" : "min-h-screen bg-page p-6"} data-testid="galerie-demo">
      <header
        className={plein ? "order-2 flex flex-wrap items-center gap-3 p-4" : "mb-4 flex flex-wrap items-center gap-3"}
        data-testid="galerie-commandes"
      >
        <h1 className="text-[length:var(--font-size-section)] font-extrabold text-encre">
          {fr("Galerie de démonstration")}
        </h1>
        <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-filet bg-feuille">
          <button
            type="button"
            className={`px-3 py-1.5 ${theme === "light" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            aria-pressed={theme === "light"}
            onClick={() => {
              setTheme("light");
              document.documentElement.dataset.theme = "light";
            }}
          >
            {fr("Jour")}
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 ${theme === "dark" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            aria-pressed={theme === "dark"}
            onClick={() => {
              setTheme("dark");
              document.documentElement.dataset.theme = "dark";
            }}
          >
            {fr("Nuit")}
          </button>
        </div>
        <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-filet bg-feuille">
          <button
            type="button"
            className={`px-3 py-1.5 ${vue === "dossier" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            onClick={() => {
              setVue("dossier");
            }}
          >
            {fr("Dossier")}
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 ${vue === "journee" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            onClick={() => {
              setVue("journee");
            }}
          >
            {fr("La journée")}
          </button>
          {(
            [
              ["dossiers", "Dossiers"],
              ["contacts", "Contacts"],
              ["mails", "Mails"],
              ["agenda", "Agenda"],
              ["facturation", "Facturation"],
              ["temps", "Temps"],
              ["reglages", "Réglages"],
              ["connexion", "Écran de connexion"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`px-3 py-1.5 ${vue === id ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
              data-testid={`galerie-vue-${id}`}
              onClick={() => {
                setVue(id);
              }}
            >
              {fr(label)}
            </button>
          ))}
        </div>
        {vue === "dossier"
          ? (["kraft", "bleu-classeur", "vert-amande"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`rounded-[var(--radius-control)] border border-filet px-3 py-1.5 ${
                  chemise === id ? "bg-encre font-bold text-feuille" : "bg-feuille text-graphite"
                }`}
                data-chemise={id}
                onClick={() => {
                  setChemise(id);
                }}
              >
                {fr(id.replace(/-/g, " "))}
              </button>
            ))
          : null}
        {vue === "connexion" ? (
          <div className="flex flex-wrap gap-1">
            {ETATS_CONNEXION.map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`connexion-etat-${id}`}
                aria-pressed={etatConnexion === id}
                className="rounded-[var(--radius-control)] border border-filet bg-feuille px-2 py-1 text-graphite"
                onClick={() => {
                  setEtatConnexion(id);
                }}
              >
                {fr(LIBELLES_ETAT_CONNEXION[id])}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div
        className={
          plein
            ? "coque-app order-1 h-screen w-screen overflow-hidden"
            : "coque-app mx-auto h-[800px] max-w-[1240px] overflow-hidden rounded-[14px]"
        }
        data-testid="galerie-scene"
        data-theme-capture={theme}
        data-chemise-capture={vue === "dossier" ? chemise : "neutre"}
      >
        {vue === "connexion" ? null : (
        <BarreHaut
          actif={vue}
          onNaviguer={() => undefined}
          onglets={vue === "dossier" ? onglets : []}
          ongletActifId={vue === "dossier" ? dossier.id : null}
          sync={{ kind: "synchronise" }}
          chronoSecondes={
            vue === "temps" || vue === "journee" || vue === "dossier" ? chronoTemps.secondes : undefined
          }
          chronoTitre={
            vue === "temps" || vue === "journee"
              ? fr("Chronomètre en pause sur 2026-042")
              : undefined
          }
          chronoChemise={vue === "temps" || vue === "journee" ? "kraft" : undefined}
          onChrono={vue === "temps" || vue === "journee" || vue === "dossier" ? () => undefined : undefined}
          onPalette={() => undefined}
          mailsCompteur={aClasser}
          compteMenu={
            <MenuCompte
              initiales="JM"
              onTemps={() => {
                setDernierChoixCompte("temps");
              }}
              onReglages={() => {
                setDernierChoixCompte("reglages");
              }}
              onPalette={() => {
                setDernierChoixCompte("palette");
              }}
              onVerrouiller={() => {
                setDernierChoixCompte("verrouiller");
              }}
              onDeconnecter={() => {
                setDernierChoixCompte("deconnexion");
              }}
            />
          }
        />
        )}
        <div className="coque-workspace min-h-0 flex-1">
          <span className="sr-only" data-testid="galerie-menu-dernier-choix">
            {dernierChoixCompte}
          </span>
          {vue === "dossier" ? (
            <DossierOuvert
              dossier={dossier}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
              onFacturer={() => undefined}
              onCalculerDelai={() => undefined}
              elementsChrono={CHRONO_DEMO}
              intercalairesSync={false}
              intervenantsFixes={INTERVENANTS_DEMO}
            />
          ) : null}
          {vue === "journee" ? (
            <Journee
              donneesDemo
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "dossiers" ? (
            <Dossiers
              lignesFixes={dossiersDemo}
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "contacts" ? (
            <Contacts
              lignesFixes={CONTACTS_DEMO}
              liensFixes={LIENS_CONTACTS_DEMO}
              coordonneesFixes={COORDONNEES_CONTACTS_DEMO}
              selectionInitiale="ferrand"
              comptesDossiersFixes={{ ferrand: 1, antoine: 1, duclos: 1, perrin: 1, vasseur: 1, banque: 1, rambert: 1, moreau: 1, perrache: 1, operrache: 1 }}
              doublonsFixes={{ ferrand: [{ id: "ferrand-doublon", nom: "Ferrand Metal SAS", motif: "siren" }] }}
              propositionFixe={{
                siren: "903417566",
                denomination: "FERRAND LOGISTIQUE",
                forme: "5499",
                adresseSiege: "5 AVENUE DE L'INDUSTRIE 69800 SAINT-PRIEST",
                activite: "49.41A",
                dirigeants: [
                  { nature: "physique", nom: "Ferrand", prenoms: "Antoine Louis", naissance: "1972-02", siren: null, qualite: "Gérant" },
                  { nature: "physique", nom: "Ferrand", prenoms: "Hugo", naissance: "2001-05", siren: null, qualite: "Cogérant" },
                ],
              }}
              historiqueFixe={{
                contactId: "ferrand",
                dossiers: [{ id: "dos-2026-031", nom: "SAS Ferrand Métal c/ SARL Duclos Industrie", qualite: "client, demandeur" }],
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
              }}
            />
          ) : null}
          {vue === "mails" ? (
            <EcranMails
              instanceUrl="http://127.0.0.1:8088"
              demonstration={mailsDemo}
              onComposer={() => undefined}
              onSaisirTemps={() => undefined}
              onOuvrirDossier={() => undefined}
            />
          ) : null}
          {vue === "agenda" ? (
            <EcranAgenda
              lignesFixes={agendaDemo}
              invitationsFixes={invitationsAgendaDemo}
              onOuvrirMail={() => undefined}
              onOuvrirDossier={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "temps" ? (
            <EcranTemps
              instanceUrl="http://127.0.0.1:8088"
              moiId="demo-moi"
              chrono={chronoTemps}
              onChrono={setChronoTemps}
              onFacturer={() => undefined}
              lignesFixes={tempsDemo}
            />
          ) : null}
          {vue === "facturation" ? (
            <EcranFacturation
              lignes={facturesDemo}
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "reglages" ? (
            <Reglages
              themeMode={theme}
              onThemeChange={(mode) => {
                if (mode === "light" || mode === "dark") setTheme(mode);
              }}
              instanceUrl="http://127.0.0.1:8088"
              horsLigne
              qualitesDemo={QUALITES_LIVREES.map((qualite) => ({
                id: qualite.code,
                code: qualite.code,
                libelle: qualite.libelle,
                admetRattachement: qualite.admetRattachement,
                archivee: false,
                utilisee: qualite.code === "avocat",
              }))}
              messagerieDemo={messagerieDemo}
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "connexion" ? <EcranConnexion etat={etatConnexion} /> : null}
        </div>
      </div>
    </div>
  );
}
