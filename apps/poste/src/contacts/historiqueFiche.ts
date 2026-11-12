import { dateCivile, formatDateActe, formatDateJourMois, formatMontant } from "@/lib/format";
import { libelleReferenceDossier } from "@/lib/referenceDossier";

/** Dossier où intervient le contact. `reference` et `chemise` viennent du dossier synchronisé. */
export type DossierFiche = {
  id: string;
  nom: string;
  qualite: string;
  reference: string | null;
  chemise: string | null;
};

/**
 * Facture du contact client. `reference`, `dateIso` et `objet` sont nuls tant que la base locale ne les
 * porte pas : la table `factures` synchronisée n'a ni date, ni objet, et son numéro est un entier sans année.
 */
export type FactureFiche = {
  id: string;
  reference: string | null;
  dateIso: string | null;
  objet: string | null;
  ttcCentimes: number;
  encaisseCentimes: number;
  brouillon: boolean;
};

/** Mail classé tel que la base locale le porte. */
export type MailBrut = {
  id: string;
  objet: string;
  expediteur: string;
  destinataires: string;
  etat: string;
  /** Date de l'en-tête `Date` (`date_entete`), nulle quand elle manque. */
  dateIso: string | null;
};

/** Mail prêt à afficher : objet, auteur (ou « Vous ») et date. */
export type MailFiche = {
  id: string;
  objet: string;
  auteur: string;
  dateIso: string | null;
};

export type NoteFiche = {
  id: string;
  texte: string;
};

export type SyntheseFactures = {
  /** Somme TTC des factures de la période (voir `anneeFacturation`), ou de toutes à défaut de dates. */
  factureCentimes: number;
  /** Année de la période, `null` tant qu'une facture n'a pas de date lisible. */
  annee: number | null;
  encaisseCentimes: number;
  encoursCentimes: number;
};

export type TuileFacture = {
  id: "facture" | "encaisse" | "encours";
  libelle: string;
  montant: string;
};

export type StatutFacture = "payee" | "attente" | "brouillon";

export type LigneFacture = {
  id: string;
  reference: string;
  date: string | null;
  objet: string | null;
  montant: string;
  statut: StatutFacture;
  statutLibelle: string;
};

export type LigneDossier = {
  id: string;
  reference: string;
  nom: string;
  qualite: string;
  chemise: string | null;
};

export type LigneMail = {
  id: string;
  objet: string;
  auteur: string;
  date: string | null;
};

export type EtatVide = { titre: string; phrase: string };

export const MENTION_MAILS = "Mails classés dont l'expéditeur ou un destinataire est une adresse de cette fiche.";

const ETAT_VIDE_DOSSIERS: EtatVide = {
  titre: "Aucun dossier",
  phrase:
    "Ce contact n'intervient dans aucun dossier que vous pouvez consulter. « Ajouter à un dossier » le rattache avec une qualité.",
};

/** État vide de l'onglet Dossiers (maquette `prototype-contacts.html`). */
export function etatVideDossiers(): EtatVide {
  return ETAT_VIDE_DOSSIERS;
}

const ETAT_VIDE_LIENS: EtatVide = {
  titre: "Aucun lien",
  phrase:
    "Reliez ce contact à ses dirigeants, à sa société, à sa famille ou à ses conseils. Pour une société, « Mettre à jour depuis le registre » propose ses dirigeants.",
};

const ETAT_VIDE_NOTES: EtatVide = {
  titre: "Aucune note",
  phrase: "Ce que le cabinet doit savoir de ce contact et qui n'a pas sa place ailleurs.",
};

/** La maquette n'a pas d'état vide pour Mails : même composition, avec la phrase qui explique l'onglet. */
const ETAT_VIDE_MAILS: EtatVide = { titre: "Aucun mail", phrase: MENTION_MAILS };

/** État vide de l'onglet Liens (maquette `prototype-contacts.html`). */
export function etatVideLiens(): EtatVide {
  return ETAT_VIDE_LIENS;
}

/** État vide de l'onglet Notes (maquette `prototype-contacts.html`). */
export function etatVideNotes(): EtatVide {
  return ETAT_VIDE_NOTES;
}

/** État vide de l'onglet Mails. */
export function etatVideMails(): EtatVide {
  return ETAT_VIDE_MAILS;
}

function adresses(texte: string): string[] {
  return texte
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/[<>]/g, "").toLocaleLowerCase("fr"))
    .filter((part) => part.includes("@"));
}

/** Nom affiché d'un expéditeur : « Camille Martin <camille@…> » devient « Camille Martin ». */
function nomExpediteur(expediteur: string): string {
  const texte = expediteur.trim();
  const dansChevrons = /^(.*?)\s*<[^>]*>\s*$/u.exec(texte);
  const nom = (dansChevrons?.[1] ?? "").replace(/^["']|["']$/gu, "").trim();
  if (nom !== "") return nom;
  return texte.replace(/[<>]/g, "").trim();
}

/**
 * Regroupe les lignes d'un même dossier (une par qualité) en une seule : la liste, son compteur et
 * celui de la liste des contacts comptent des dossiers distincts. Tri par nom, puis référence.
 */
export function regrouperDossiers(dossiers: readonly DossierFiche[]): DossierFiche[] {
  const parId = new Map<string, DossierFiche>();
  for (const dossier of dossiers) {
    const existant = parId.get(dossier.id);
    if (existant === undefined) {
      parId.set(dossier.id, { ...dossier });
    } else if (dossier.qualite !== "" && !existant.qualite.split(", ").includes(dossier.qualite)) {
      existant.qualite = existant.qualite === "" ? dossier.qualite : `${existant.qualite}, ${dossier.qualite}`;
    }
  }
  return [...parId.values()].sort(
    (a, b) =>
      a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }) ||
      (a.reference ?? "").localeCompare(b.reference ?? "", "fr", { numeric: true }),
  );
}

/** Casse de phrase : la qualité s'écrit en minuscules en base, l'écran la commence par une majuscule. */
function majuscule(texte: string): string {
  const premier = texte.charAt(0);
  return premier.toLocaleUpperCase("fr") + texte.slice(1);
}

export function lignesDossiers(dossiers: readonly DossierFiche[]): LigneDossier[] {
  return regrouperDossiers(dossiers).map((dossier) => ({
    id: dossier.id,
    reference: libelleReferenceDossier(dossier.reference),
    nom: dossier.nom,
    qualite: majuscule(dossier.qualite),
    chemise: dossier.chemise,
  }));
}

/** Année de la facturation : celle de la facture la plus récente, si toutes ont une date lisible. */
export function anneeFacturation(factures: readonly FactureFiche[]): number | null {
  if (factures.length === 0) return null;
  let annee: number | null = null;
  for (const facture of factures) {
    const date = facture.dateIso === null ? null : dateCivile(facture.dateIso);
    if (date === null) return null;
    if (annee === null || date.annee > annee) annee = date.annee;
  }
  return annee;
}

/** Encours = reste à payer, jamais négatif. */
export function syntheseFactures(factures: readonly FactureFiche[]): SyntheseFactures {
  const annee = anneeFacturation(factures);
  let facture = 0;
  let encaisse = 0;
  let encours = 0;
  for (const ligne of factures) {
    encaisse += ligne.encaisseCentimes;
    const reste = ligne.ttcCentimes - ligne.encaisseCentimes;
    encours += reste > 0 ? reste : 0;
    const date = ligne.dateIso === null ? null : dateCivile(ligne.dateIso);
    if (annee === null || date?.annee === annee) facture += ligne.ttcCentimes;
  }
  return { factureCentimes: facture, annee, encaisseCentimes: encaisse, encoursCentimes: encours };
}

/** Les trois tuiles de l'onglet Factures. Le libellé de la première ne cite l'année que si elle est connue. */
export function tuilesFactures(factures: readonly FactureFiche[]): TuileFacture[] {
  const synthese = syntheseFactures(factures);
  return [
    {
      id: "facture",
      libelle: synthese.annee === null ? "Facturé" : `Facturé en ${String(synthese.annee)}`,
      montant: formatMontant(synthese.factureCentimes),
    },
    { id: "encaisse", libelle: "Encaissé", montant: formatMontant(synthese.encaisseCentimes) },
    { id: "encours", libelle: "Encours", montant: formatMontant(synthese.encoursCentimes) },
  ];
}

export function statutFacture(facture: FactureFiche): StatutFacture {
  if (facture.brouillon) return "brouillon";
  return facture.ttcCentimes > 0 && facture.encaisseCentimes >= facture.ttcCentimes ? "payee" : "attente";
}

const LIBELLE_STATUT: Record<StatutFacture, string> = {
  payee: "Payée",
  attente: "En attente",
  brouillon: "Brouillon",
};

/** Ordre chronologique quand les dates existent, sinon par numéro ; les factures sans date ou sans numéro passent en dernier. */
export function trierFactures(factures: readonly FactureFiche[]): FactureFiche[] {
  return [...factures].sort((a, b) => {
    if (a.dateIso !== b.dateIso) {
      if (a.dateIso === null) return 1;
      if (b.dateIso === null) return -1;
      const ecart = a.dateIso.localeCompare(b.dateIso);
      if (ecart !== 0) return ecart;
    }
    if (a.reference === null || b.reference === null) {
      if (a.reference === b.reference) return 0;
      return a.reference === null ? 1 : -1;
    }
    return a.reference.localeCompare(b.reference, "fr", { numeric: true });
  });
}

export function lignesFactures(factures: readonly FactureFiche[]): LigneFacture[] {
  return trierFactures(factures).map((facture) => {
    const statut = statutFacture(facture);
    return {
      id: facture.id,
      reference: facture.reference ?? "Sans numéro",
      date: facture.dateIso === null ? null : formatDateActe(facture.dateIso) || null,
      objet: facture.objet,
      montant: formatMontant(facture.ttcCentimes),
      statut,
      statutLibelle: LIBELLE_STATUT[statut],
    };
  });
}

/** Colonnes Date et Objet : présentes seulement si au moins une facture porte la donnée. */
export function colonnesFactures(lignes: readonly LigneFacture[]): { date: boolean; objet: boolean } {
  return {
    date: lignes.some((ligne) => ligne.date !== null),
    objet: lignes.some((ligne) => ligne.objet !== null && ligne.objet !== ""),
  };
}

/**
 * Mails classés dont l'expéditeur ou un destinataire est une adresse de la fiche, du plus récent au plus
 * ancien. L'auteur est « Vous » quand l'expéditeur est une adresse d'un compte mail du cabinet.
 */
export function mailsDuContact(
  mails: readonly MailBrut[],
  emails: readonly string[],
  adressesCabinet: readonly string[] = [],
): MailFiche[] {
  const connus = new Set(emails.map((email) => email.trim().toLocaleLowerCase("fr")).filter((email) => email !== ""));
  if (connus.size === 0) return [];
  const cabinet = new Set(adressesCabinet.map((adresse) => adresse.trim().toLocaleLowerCase("fr")));
  return mails
    .filter((mail) => {
      if (mail.etat !== "classe") return false;
      const presents = [...adresses(mail.expediteur), ...adresses(mail.destinataires)];
      return presents.some((adresse) => connus.has(adresse));
    })
    .map((mail) => ({
      id: mail.id,
      objet: mail.objet,
      auteur: adresses(mail.expediteur).some((adresse) => cabinet.has(adresse))
        ? "Vous"
        : nomExpediteur(mail.expediteur),
      dateIso: mail.dateIso,
    }))
    .sort((a, b) => {
      if (a.dateIso === b.dateIso) return 0;
      if (a.dateIso === null) return 1;
      if (b.dateIso === null) return -1;
      return b.dateIso.localeCompare(a.dateIso);
    });
}

export function lignesMails(mails: readonly MailFiche[], anneeCourante: number): LigneMail[] {
  return mails.map((mail) => ({
    id: mail.id,
    objet: mail.objet,
    auteur: mail.auteur,
    date: mail.dateIso === null ? null : formatDateJourMois(mail.dateIso, anneeCourante) || null,
  }));
}
