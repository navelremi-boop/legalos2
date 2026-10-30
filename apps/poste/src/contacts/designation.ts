import { formatDateActe } from "@/lib/format";
import type { LienAffiche } from "@/contacts/liensContacts";
import { libelleForme } from "@/contacts/formesJuridiques";
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

  const tete = [civiliteRefusee(civilite) ? "" : civilite, prenoms, nom].filter((part) => part !== "").join(" ");
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

  const nationalite = contact.nationalite?.trim() ?? "";
  if (nationalite === "") mentions.push(mention("nationalite", "nationalité"));
  else morceaux.push(nationalite);

  const profession = contact.profession?.trim() ?? "";
  if (profession === "") mentions.push(mention("profession", "profession"));
  else morceaux.push(profession);

  const adresse = contact.adresseDomicile?.trim() ?? "";
  if (adresse === "") mentions.push(mention("adresse_domicile", "adresse du domicile principal"));
  else morceaux.push(adresse);

  return { texte: morceaux.join(", "), mentions };
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

function texteMorale(contact: ContactListe, contexte: ContexteDesignation): DesignationActe {
  const mentions: MentionManquante[] = [];
  const morceaux: string[] = [];
  const nom = contact.nom.trim();
  if (nom === "") mentions.push(mention("denomination", "dénomination"));
  else morceaux.push(nom);

  const forme = libelleForme(contact.forme ?? "");
  if (forme === "") mentions.push(mention("forme", "forme"));
  else morceaux.push(forme);

  const capital = contact.capitalLibelle?.trim() ?? "";
  if (capital === "") mentions.push(mention("capital", "capital"));
  else morceaux.push(capital);

  const greffe = contact.greffe?.trim() ?? "";
  const siren = contact.siren?.trim() ?? "";
  if (greffe === "") mentions.push(mention("greffe", "greffe du RCS"));
  if (siren === "") mentions.push(mention("siren", "numéro du RCS"));
  if (greffe !== "" && siren !== "") morceaux.push(`${greffe}, numéro ${siren}`);

  const siege = contact.adresseSiege?.trim() ?? "";
  if (siege === "") mentions.push(mention("adresse_siege", "adresse du siège"));
  else morceaux.push(siege);

  const mandat = mandatRepresentant(contact.id, contexte.liens);
  if (mandat === null) {
    mentions.push(mention("representant", "organe représentant"));
  } else {
    const organe = representantDuMandat(mandat, contexte.contacts);
    if (organe.representant === null) mentions.push(...organe.mentions);
    else morceaux.push(phraseRepresentant(organe.representant));
  }

  return { texte: morceaux.join(", "), mentions };
}

function phraseRepresentant(representant: RepresentantFiche): string {
  const domicile = participe(representant.accord, "domiciliée", "domicilié");
  return `prise en la personne de son ${representant.fonction} en exercice, ${representant.civilite} ${representant.prenoms} ${representant.nom}, ${domicile} en cette qualité audit siège`;
}

function titreProfession(code: ProfessionReglementee, accord: AccordGrammatical): string {
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
    const civiliteUtile = civiliteRefusee(civilite) ? "" : civilite;
    if (civiliteUtile === "") mentions.push(mention("civilite", "civilité"));
    identite = [civiliteUtile, prenoms, nom].filter((part) => part !== "").join(" ");
  }
  const morceaux = [identite, titre].filter((part) => part !== "");
  if (code === "avocat") {
    const barreau = contact.barreau?.trim() ?? "";
    if (barreau === "") mentions.push(mention("barreau", "barreau"));
    else if (titre !== "") morceaux[morceaux.length - 1] = `${titre} au barreau de ${barreau}`;
  }
  if (code === "expert_judiciaire") {
    const specialite = contact.specialite?.trim() ?? "";
    const cour = contact.courAppel?.trim() ?? "";
    if (specialite === "") mentions.push(mention("specialite", "spécialité"));
    else morceaux.push(specialite);
    if (cour === "") mentions.push(mention("cour_appel", "cour d'appel"));
    else morceaux.push(`cour d'appel de ${cour}`);
  }
  return { texte: morceaux.join(", "), mentions };
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
  const professionnelle = texteProfessionnel(contact);
  if (professionnelle !== null) return professionnelle;
  if (contact.nature === "morale") return texteMorale(contact, contexte);
  return textePersonne(contact);
}
