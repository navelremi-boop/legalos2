import { formatDateActe } from "@/lib/format";
import { deElide } from "@/contacts/elision";
import { formeSansPrecision } from "@/contacts/formesJuridiques";
import type { LienAffiche } from "@/contacts/liensContacts";
import {
  civiliteActe,
  greffeSansRcs,
  minusculeInitiale,
  nationaliteAccordee,
  prenomUsuel,
  sirenEnGroupes,
} from "@/contacts/redactionActe";
import type {
  AccordGrammatical,
  ContactListe,
  ProfessionReglementee,
  RepresentantFiche,
} from "@/contacts/listeContacts";

export type MentionManquante = {
  champ: string;
  libelle: string;
};

export type DesignationActe = {
  texte: string;
  mentions: MentionManquante[];
};

const CIVILITES_REFUSEES = new Set(["mademoiselle"]);

const PROFESSIONS_ME = new Set<ProfessionReglementee>(["avocat", "commissaire_justice", "notaire"]);

export function civiliteRefusee(libelle: string): boolean {
  return CIVILITES_REFUSEES.has(libelle.trim().toLocaleLowerCase("fr"));
}

/** Madame et Monsieur déduisent l'accord. Toute autre civilité le demande. */
export function accordDe(civilite: string, accordSaisi: AccordGrammatical | null): AccordGrammatical | null {
  const net = civilite.trim();
  if (net === "" || civiliteRefusee(net)) return null;
  if (net === "Madame") return "feminin";
  if (net === "Monsieur") return "masculin";
  return accordSaisi;
}

function participe(accord: AccordGrammatical, feminin: string, masculin: string): string {
  return accord === "feminin" ? feminin : masculin;
}

function mention(champ: string, libelle: string): MentionManquante {
  return { champ, libelle };
}

/** Une désignation est une phrase : morceaux séparés par des virgules, terminée par un point. */
function phrase(morceaux: readonly string[]): string {
  return morceaux.length === 0 ? "" : `${morceaux.join(", ")}.`;
}

/**
 * Personne physique : « [M. ou Mme] [prénoms] [nom], né(e) [le …] à [lieu], de nationalité [nationalité],
 * [profession], demeurant [adresse]. »
 */
function textePersonne(contact: ContactListe): DesignationActe {
  const mentions: MentionManquante[] = [];
  const civilite = contact.civilite?.trim() ?? "";
  if (civilite === "" || civiliteRefusee(civilite)) {
    mentions.push(mention("civilite", "civilité"));
  }
  const prenoms = contact.prenoms?.trim() ?? "";
  if (prenoms === "") mentions.push(mention("prenoms", "prénoms"));
  const nom = contact.nom.trim();
  if (nom === "") mentions.push(mention("nom", "nom"));
  const accord = civilite === "" || civiliteRefusee(civilite) ? null : accordDe(civilite, contact.accordSaisi);
  if (accord === null && civilite !== "" && !civiliteRefusee(civilite)) {
    mentions.push(mention("accord", "accord grammatical"));
  }

  const tete = [civiliteRefusee(civilite) ? "" : civiliteActe(civilite), prenoms, nom]
    .filter((part) => part !== "")
    .join(" ");
  const morceaux: string[] = [];
  if (tete !== "") morceaux.push(tete);

  const date = contact.dateNaissance ? formatDateActe(contact.dateNaissance) : "";
  if (date === "") mentions.push(mention("date_naissance", "date de naissance"));
  const lieu = contact.lieuNaissance?.trim() ?? "";
  if (lieu === "") mentions.push(mention("lieu_naissance", "lieu de naissance"));
  if (accord !== null && date !== "" && lieu !== "") {
    const naissance = contact.nomNaissance?.trim() ?? "";
    const differente =
      naissance !== "" && naissance.toLocaleLowerCase("fr") !== nom.toLocaleLowerCase("fr") ? naissance : "";
    const ne = participe(accord, "née", "né");
    morceaux.push(`${ne}${differente === "" ? "" : ` ${differente}`} le ${date} à ${lieu}`);
  }

  const nationalite = nationaliteAccordee(contact.nationalite);
  if (nationalite === "") mentions.push(mention("nationalite", "nationalité"));
  else morceaux.push(`de nationalité ${nationalite}`);

  const profession = contact.profession?.trim() ?? "";
  if (profession === "") mentions.push(mention("profession", "profession"));
  else morceaux.push(minusculeInitiale(profession));

  const adresse = contact.adresseDomicile?.trim() ?? "";
  if (adresse === "") mentions.push(mention("adresse_domicile", "adresse du domicile principal"));
  else morceaux.push(`demeurant ${adresse}`);

  return { texte: phrase(morceaux), mentions };
}

/** Un seul mandat en cours par fonction peut représenter la société. Cet ordre tranche s'il y en a plusieurs. */
const ORDRE_MANDAT = [
  "gerant",
  "president",
  "directeur_general",
  "directeur_general_delegue",
  "administrateur",
  "membre_directoire",
  "membre_conseil_surveillance",
  "liquidateur_amiable",
];

const FONCTION_ACCORD: Record<string, { feminin: string; masculin: string }> = {
  gerant: { feminin: "gérante", masculin: "gérant" },
  president: { feminin: "présidente", masculin: "président" },
  directeur_general: { feminin: "directrice générale", masculin: "directeur général" },
  directeur_general_delegue: { feminin: "directrice générale déléguée", masculin: "directeur général délégué" },
  administrateur: { feminin: "administratrice", masculin: "administrateur" },
  membre_directoire: { feminin: "membre du directoire", masculin: "membre du directoire" },
  membre_conseil_surveillance: {
    feminin: "membre du conseil de surveillance",
    masculin: "membre du conseil de surveillance",
  },
  liquidateur_amiable: { feminin: "liquidatrice amiable", masculin: "liquidateur amiable" },
};

/** Fonction d'un mandat accordée avec la personne qui l'exerce (« directrice générale »), ou null si le code est inconnu. */
export function fonctionMandatAccordee(code: string | null, accord: AccordGrammatical | null): string | null {
  const formes = FONCTION_ACCORD[code ?? ""];
  if (formes === undefined) return null;
  return participe(accord ?? "masculin", formes.feminin, formes.masculin);
}

function mandatRepresentant(societeId: string, liens: readonly LienAffiche[]): LienAffiche | null {
  const candidats = liens.filter(
    (lien) =>
      lien.cibleId === societeId &&
      lien.typeLien === "mandat_social" &&
      lien.representeSociete &&
      (lien.fin === null || lien.fin.trim() === ""),
  );
  candidats.sort(
    (a, b) =>
      ORDRE_MANDAT.indexOf(a.fonction ?? "") - ORDRE_MANDAT.indexOf(b.fonction ?? ""),
  );
  return candidats[0] ?? null;
}

function representantDuMandat(
  lien: LienAffiche,
  contacts: readonly ContactListe[],
): { representant: RepresentantFiche | null; mentions: MentionManquante[] } {
  const personne = contacts.find((contact) => contact.id === lien.sourceId);
  const civilite = (personne?.civilite ?? lien.sourceCivilite ?? "").trim();
  const prenoms = (personne?.prenoms ?? lien.sourcePrenoms ?? "").trim();
  const nom = (personne?.nom ?? lien.sourceNom).trim();
  const mentions: MentionManquante[] = [];
  if (civilite === "" || civiliteRefusee(civilite)) mentions.push(mention("civilite", "civilité"));
  if (prenoms === "") mentions.push(mention("prenoms", "prénoms"));
  if (nom === "") mentions.push(mention("nom", "nom"));
  const accord = civilite === "" || civiliteRefusee(civilite) ? null : accordDe(civilite, personne?.accordSaisi ?? null);
  if (accord === null) mentions.push(mention("accord", "accord grammatical"));
  const formes = FONCTION_ACCORD[lien.fonction ?? ""];
  if (formes === undefined || accord === null || civilite === "" || prenoms === "" || nom === "") {
    if (formes === undefined) mentions.push(mention("fonction", "fonction du mandat"));
    return { representant: null, mentions };
  }
  return {
    representant: {
      fonction: participe(accord, formes.feminin, formes.masculin),
      civilite,
      prenoms,
      nom,
      accord,
    },
    mentions: [],
  };
}

/**
 * Société : « La société [dénomination], [forme en toutes lettres] au capital de [capital] €, immatriculée au
 * registre du commerce et des sociétés de [greffe] sous le numéro [SIREN], dont le siège social est situé [adresse],
 * prise en la personne de son [fonction] en exercice, [M. ou Mme] [prénom usuel] [nom], domicilié(e) en cette
 * qualité audit siège. » Une société exerçant une profession réglementée suit la même formule.
 */
function texteMorale(contact: ContactListe, contexte: ContexteDesignation): DesignationActe {
  const mentions: MentionManquante[] = [];
  const morceaux: string[] = [];
  const nom = contact.nom.trim();
  if (nom === "") mentions.push(mention("denomination", "dénomination"));
  else morceaux.push(`La société ${nom}`);

  const formeBrute = contact.forme?.trim() ?? "";
  const forme = formeBrute === "" ? "" : minusculeInitiale(formeSansPrecision(formeBrute));
  if (forme === "") mentions.push(mention("forme", "forme"));
  const capitalBrut = contact.capitalLibelle?.trim() ?? "";
  if (capitalBrut === "") mentions.push(mention("capital", "capital"));
  const capital =
    capitalBrut === "" || /^au capital/iu.test(capitalBrut) ? capitalBrut : `au capital de ${capitalBrut}`;
  const identite = [forme, capital].filter((part) => part !== "").join(" ");
  if (identite !== "") morceaux.push(identite);

  const greffe = greffeSansRcs(contact.greffe);
  const siren = sirenEnGroupes(contact.siren);
  if (greffe === "") mentions.push(mention("greffe", "greffe du RCS"));
  if (siren === "") mentions.push(mention("siren", "numéro du RCS"));
  if (greffe !== "" || siren !== "") {
    const lieu = greffe === "" ? "" : ` ${deElide(greffe)}`;
    const numero = siren === "" ? "" : ` sous le numéro ${siren}`;
    morceaux.push(`immatriculée au registre du commerce et des sociétés${lieu}${numero}`);
  }

  const siege = contact.adresseSiege?.trim() ?? "";
  if (siege === "") mentions.push(mention("adresse_siege", "adresse du siège"));
  else morceaux.push(`dont le siège social est situé ${siege}`);

  const mandat = mandatRepresentant(contact.id, contexte.liens);
  if (mandat === null) {
    mentions.push(mention("representant", "organe représentant"));
  } else {
    const organe = representantDuMandat(mandat, contexte.contacts);
    if (organe.representant === null) mentions.push(...organe.mentions);
    else morceaux.push(phraseRepresentant(organe.representant, mandat.fonction));
  }

  return { texte: phrase(morceaux), mentions };
}

/** « sa gérante » quand le féminin diffère du masculin, « son président » sinon (« son membre du directoire »). */
function possessifFonction(code: string | null, accord: AccordGrammatical): string {
  const formes = FONCTION_ACCORD[code ?? ""];
  return accord === "feminin" && formes !== undefined && formes.feminin !== formes.masculin ? "sa" : "son";
}

function phraseRepresentant(representant: RepresentantFiche, codeFonction: string | null): string {
  const domicile = participe(representant.accord, "domiciliée", "domicilié");
  const possessif = possessifFonction(codeFonction, representant.accord);
  const identite = [civiliteActe(representant.civilite), prenomUsuel(representant.prenoms), representant.nom.trim()]
    .filter((part) => part !== "")
    .join(" ");
  return `prise en la personne de ${possessif} ${representant.fonction} en exercice, ${identite}, ${domicile} en cette qualité audit siège`;
}

export function titreProfession(code: ProfessionReglementee, accord: AccordGrammatical): string {
  switch (code) {
    case "avocat":
      return participe(accord, "avocate", "avocat");
    case "commissaire_justice":
      return "commissaire de justice";
    case "notaire":
      return "notaire";
    case "expert_judiciaire":
      return participe(accord, "experte judiciaire", "expert judiciaire");
    case "administrateur_judiciaire":
      return participe(accord, "administratrice judiciaire", "administrateur judiciaire");
    case "mandataire_judiciaire":
      return "mandataire judiciaire";
    case "expert_comptable":
      return participe(accord, "experte-comptable", "expert-comptable");
    case "commissaire_comptes":
      return "commissaire aux comptes";
  }
}

/** Professionnel (personne physique) : « Me [prénom nom], avocat(e) au barreau de … » et équivalents. */
function texteProfessionnel(contact: ContactListe): DesignationActe | null {
  const code = contact.professionCode;
  if (code === null) return null;
  const mentions: MentionManquante[] = [];
  const prenoms = contact.prenoms?.trim() ?? "";
  const nom = contact.nom.trim();
  if (prenoms === "") mentions.push(mention("prenoms", "prénoms"));
  if (nom === "") mentions.push(mention("nom", "nom"));
  const civilite = contact.civilite?.trim() ?? "";
  const accord = civilite === "" || civiliteRefusee(civilite) ? contact.accordSaisi : accordDe(civilite, contact.accordSaisi);
  if (accord === null) mentions.push(mention("accord", "accord grammatical"));
  const titre = accord === null ? "" : titreProfession(code, accord);
  let identite = "";
  if (PROFESSIONS_ME.has(code)) {
    identite = ["Me", prenoms, nom].filter((part) => part !== "").join(" ");
  } else {
    const civiliteUtile = civiliteRefusee(civilite) ? "" : civiliteActe(civilite);
    if (civiliteUtile === "") mentions.push(mention("civilite", "civilité"));
    identite = [civiliteUtile, prenoms, nom].filter((part) => part !== "").join(" ");
  }
  const morceaux = [identite, titre].filter((part) => part !== "");
  if (code === "avocat") {
    const barreau = contact.barreau?.trim() ?? "";
    if (barreau === "") mentions.push(mention("barreau", "barreau"));
    else if (titre !== "") morceaux[morceaux.length - 1] = `${titre} au barreau ${deElide(barreau)}`;
  }
  if (code === "expert_judiciaire") {
    const specialite = contact.specialite?.trim() ?? "";
    const cour = contact.courAppel?.trim() ?? "";
    if (specialite === "") mentions.push(mention("specialite", "spécialité"));
    else morceaux.push(specialite);
    if (cour === "") mentions.push(mention("cour_appel", "cour d'appel"));
    else morceaux.push(`cour d'appel ${deElide(cour)}`);
  }
  return { texte: phrase(morceaux), mentions };
}

export type ContexteDesignation = {
  liens: readonly LienAffiche[];
  contacts: readonly ContactListe[];
};

const CONTEXTE_VIDE: ContexteDesignation = { liens: [], contacts: [] };

/** Personne du mandat en cours qui représente la société, s'il y en a une. */
export function ficheRepresentant(
  societeId: string,
  contexte: ContexteDesignation = CONTEXTE_VIDE,
): ContactListe | null {
  const mandat = mandatRepresentant(societeId, contexte.liens);
  if (mandat === null) return null;
  return contexte.contacts.find((contact) => contact.id === mandat.sourceId) ?? null;
}

/** Désignation calculée. Le texte n'invente pas une mention absente : elle est nommée à part. */
export function designationActe(
  contact: ContactListe,
  contexte: ContexteDesignation = CONTEXTE_VIDE,
): DesignationActe {
  // Une société, même exerçant une profession réglementée, suit la formule des sociétés.
  if (contact.nature === "morale") return texteMorale(contact, contexte);
  const professionnelle = texteProfessionnel(contact);
  if (professionnelle !== null) return professionnelle;
  return textePersonne(contact);
}
