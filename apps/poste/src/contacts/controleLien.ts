import type { LienAffiche } from "@/contacts/liensContacts";

/**
 * Contrôles d'un lien entre deux contacts, appliqués au poste avant l'écriture locale. L'API les refait à l'envoi
 * (`crates/api/src/fiche_contact.rs`, `routes/contacts.rs`) ; un refus revient sur le poste en message lisible.
 */

export type SaisieLien = {
  typeLien: string;
  fonction: string;
  libelle: string;
  representeSociete: boolean;
  debut: string;
  fin: string;
  source: string;
  note: string;
};

export type ChampLien = "cible" | "typeLien" | "fonction" | "libelle" | "representeSociete" | "debut" | "fin";

export type CibleLien = { id: string; nature: "physique" | "morale" };

export type ContexteLien = {
  sourceId: string;
  /** Contact lié (« Avec ») ; `null` tant qu'il n'est pas choisi. */
  cible: CibleLien | null;
  /** Tous les liens connus du poste : le mandat qui représente déjà la société s'y cherche. */
  liensExistants: readonly LienAffiche[];
  /** Identifiant du lien modifié ; `null` pour une création. */
  lienId: string | null;
};

export const TYPES_LIEN_SAISIS: readonly { code: string; libelle: string }[] = [
  { code: "mandat_social", libelle: "Mandat social" },
  { code: "representant_permanent", libelle: "Représentant permanent" },
  { code: "salarie", libelle: "Salarié" },
  { code: "conjoint_pacs", libelle: "Conjoint ou partenaire de PACS" },
  { code: "parent", libelle: "Parent" },
  { code: "expert_comptable", libelle: "Expert-comptable" },
  { code: "commissaire_comptes", libelle: "Commissaire aux comptes" },
  { code: "autre", libelle: "Autre" },
];

export const FONCTIONS_MANDAT: readonly { code: string; libelle: string }[] = [
  { code: "gerant", libelle: "Gérant" },
  { code: "president", libelle: "Président" },
  { code: "directeur_general", libelle: "Directeur général" },
  { code: "directeur_general_delegue", libelle: "Directeur général délégué" },
  { code: "administrateur", libelle: "Administrateur" },
  { code: "membre_directoire", libelle: "Membre du directoire" },
  { code: "membre_conseil_surveillance", libelle: "Membre du conseil de surveillance" },
  { code: "liquidateur_amiable", libelle: "Liquidateur amiable" },
];

export function saisieLienVide(): SaisieLien {
  return {
    typeLien: "mandat_social",
    fonction: "gerant",
    libelle: "",
    representeSociete: false,
    debut: "",
    fin: "",
    source: "",
    note: "",
  };
}

/** Date civile AAAA-MM-JJ qui existe au calendrier (le 30 février n'existe pas). */
export function dateLienValide(date: string): boolean {
  const trouve = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (trouve === null) return false;
  const annee = Number(trouve[1]);
  const mois = Number(trouve[2]);
  const jour = Number(trouve[3]);
  const utc = new Date(Date.UTC(annee, mois - 1, jour));
  return utc.getUTCFullYear() === annee && utc.getUTCMonth() === mois - 1 && utc.getUTCDate() === jour;
}

function texteOuNull(valeur: string): string | null {
  const net = valeur.trim();
  return net === "" ? null : net;
}

/** Lien tel qu'il s'écrit : textes rognés, vides à `null`, fonction et libellé seulement s'ils servent au type. */
export type LienNormalise = {
  typeLien: string;
  fonction: string | null;
  libelle: string | null;
  representeSociete: boolean;
  debut: string | null;
  fin: string | null;
  source: string | null;
  note: string | null;
};

export function normaliserLien(saisie: SaisieLien): LienNormalise {
  const mandat = saisie.typeLien === "mandat_social";
  return {
    typeLien: saisie.typeLien.trim(),
    fonction: mandat ? texteOuNull(saisie.fonction) : null,
    libelle: saisie.typeLien === "autre" ? texteOuNull(saisie.libelle) : null,
    representeSociete: mandat && saisie.representeSociete,
    debut: texteOuNull(saisie.debut),
    fin: texteOuNull(saisie.fin),
    source: texteOuNull(saisie.source),
    note: texteOuNull(saisie.note),
  };
}

export type ResultatControleLien =
  | { ok: true; lien: LienNormalise }
  | { ok: false; erreurs: Partial<Record<ChampLien, string>>; message: string };

/**
 * Contrôle un lien avant son écriture locale. Critères du jalon : fin postérieure au début ; fin sans début
 * refusée ; un mandat social vise une personne morale ; au plus un mandat en cours qui représente la société
 * par fonction ; un contact ne se lie pas à lui-même ; dates AAAA-MM-JJ.
 *
 * `creation` suit l'API : à la création, un second mandat qui représente la société pour la même fonction est
 * refusé tant qu'un mandat en cours le représente déjà ; à la modification, seulement si le lien reste en cours.
 */
export function controlerLien(saisie: SaisieLien, contexte: ContexteLien): ResultatControleLien {
  const lien = normaliserLien(saisie);
  const erreurs: Partial<Record<ChampLien, string>> = {};
  const mandat = lien.typeLien === "mandat_social";

  if (!TYPES_LIEN_SAISIS.some((type) => type.code === lien.typeLien)) {
    erreurs.typeLien = "Choisissez un type de lien.";
  }
  if (contexte.cible === null) {
    erreurs.cible = "Choisissez le contact à relier.";
  } else if (contexte.cible.id === contexte.sourceId) {
    erreurs.cible = "Un contact ne se lie pas à lui-même.";
  } else if (mandat && contexte.cible.nature !== "morale") {
    erreurs.cible = "Un mandat social vise une personne morale.";
  }
  if (mandat && !FONCTIONS_MANDAT.some((fonction) => fonction.code === lien.fonction)) {
    erreurs.fonction = "Choisissez la fonction du mandat.";
  }
  if (lien.typeLien === "autre" && lien.libelle === null) {
    erreurs.libelle = "Précisez le libellé du lien.";
  }
  if (saisie.representeSociete && !mandat) {
    erreurs.representeSociete = "Seul un mandat social représente la société.";
  }

  let datesValides = true;
  if (lien.debut !== null && !dateLienValide(lien.debut)) {
    erreurs.debut = "La date de début doit être au format AAAA-MM-JJ.";
    datesValides = false;
  }
  if (lien.fin !== null && !dateLienValide(lien.fin)) {
    erreurs.fin = "La date de fin doit être au format AAAA-MM-JJ.";
    datesValides = false;
  }
  if (datesValides && lien.fin !== null) {
    if (lien.debut === null) {
      erreurs.fin = "Indiquez la date de début pour poser une date de fin.";
    } else if (lien.fin <= lien.debut) {
      erreurs.fin = "La fin doit être postérieure au début.";
    }
  }

  if (
    contexte.cible !== null &&
    mandat &&
    lien.representeSociete &&
    erreurs.cible === undefined &&
    (contexte.lienId === null || lien.fin === null)
  ) {
    const deja = contexte.liensExistants.some(
      (autre) =>
        autre.id !== contexte.lienId &&
        autre.cibleId === contexte.cible?.id &&
        autre.typeLien === "mandat_social" &&
        autre.representeSociete &&
        autre.fin === null &&
        autre.fonction === lien.fonction,
    );
    if (deja) {
      erreurs.representeSociete = "Un mandat en cours représente déjà la société pour cette fonction.";
    }
  }

  const premiere = Object.values(erreurs)[0];
  if (premiere !== undefined) return { ok: false, erreurs, message: premiere };
  return { ok: true, lien };
}

/** Saisie d'un lien existant, pour le formulaire « Modifier ». */
export function saisieDepuisLien(lien: LienAffiche): SaisieLien {
  return {
    typeLien: lien.typeLien,
    fonction: lien.fonction ?? "",
    libelle: lien.libelle ?? "",
    representeSociete: lien.representeSociete,
    debut: lien.debut ?? "",
    fin: lien.fin ?? "",
    source: lien.source ?? "",
    note: "",
  };
}

export type ChampsLienModifies = {
  debut?: string | null;
  fin?: string | null;
  source?: string | null;
};

/**
 * Champs que « Modifier » change : début, fin et source, seuls les écarts avec le lien actuel partent ;
 * `null` efface. Le type, la fonction, la cible et le marquage de représentation ne changent pas.
 */
export function champsModifies(lien: LienAffiche, saisie: SaisieLien): ChampsLienModifies {
  const nouveau = normaliserLien({ ...saisieDepuisLien(lien), debut: saisie.debut, fin: saisie.fin, source: saisie.source });
  const champs: ChampsLienModifies = {};
  if (nouveau.debut !== (lien.debut ?? null)) champs.debut = nouveau.debut;
  if (nouveau.fin !== (lien.fin ?? null)) champs.fin = nouveau.fin;
  const sourceActuelle = texteOuNull(lien.source ?? "");
  if (nouveau.source !== sourceActuelle) champs.source = nouveau.source;
  return champs;
}
