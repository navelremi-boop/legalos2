/**
 * Classement des mails (§ 3.8.1) : un mail est « à classer » tant qu'il n'est pas rangé dans un dossier,
 * qu'une suggestion existe (`suggestion`) ou non (`a_classer`). Un seul endroit pour cette règle :
 * le badge de la navigation, le rail, la liste et le sous-titre de l'écran la partagent.
 */

export type EtatClassement = "classe" | "suggestion" | "a_classer";

/** Condition SQL (base locale) des mails à classer, partagée avec le badge de la navigation. */
export const CONDITION_SQL_A_CLASSER = "etat_classement IN ('a_classer', 'suggestion')";

export type MailClassable = {
  etat_classement: string | null;
  lu?: number | boolean | null;
};

export function estAClasser(etat: string | null | undefined): boolean {
  return etat === "a_classer" || etat === "suggestion";
}

export function estLu(mail: Pick<MailClassable, "lu">): boolean {
  return mail.lu === true || (typeof mail.lu === "number" && mail.lu !== 0);
}

/** Nombre de mails à classer, en tenant compte des classements déjà demandés et pas encore synchronisés. */
export function compterAClasser(
  mails: readonly (MailClassable & { id: string })[],
  dejaClasses: ReadonlySet<string> = new Set<string>(),
): number {
  return mails.filter((mail) => estAClasser(mail.etat_classement) && !dejaClasses.has(mail.id)).length;
}

export function compterNonLus(mails: readonly MailClassable[]): number {
  return mails.filter((mail) => !estLu(mail)).length;
}

function pluriel(n: number, singulier: string, plurielForme: string): string {
  return n > 1 ? plurielForme : singulier;
}

/** Sous-titre de l'écran : « 2 mails à classer, 2 non lus » ou « Tout est classé ». */
export function sousTitreEcran(aClasser: number, nonLus: number): string {
  if (aClasser <= 0) return "Tout est classé";
  return `${String(aClasser)} ${pluriel(aClasser, "mail", "mails")} à classer, ${String(nonLus)} ${pluriel(nonLus, "non lu", "non lus")}`;
}

export type DossierClassement = {
  id: string;
  nom: string;
  chemise: string;
  reference?: string | null;
};

export type EncartClassement =
  | { genre: "classe"; dossier: DossierClassement | null }
  | { genre: "suggestion"; dossier: DossierClassement | null; dossierId: string }
  | { genre: "hors-dossier" };

/**
 * Ce que dit l'encart de classement d'un message.
 * `classeLocalement` : id du dossier choisi par l'utilisateur, la synchronisation n'ayant pas encore rendu
 * l'état `classe`.
 */
export function encartClassement(
  mail: { etat_classement: string | null; dossier_id: string | null; suggestion_dossier_id: string | null },
  dossiers: ReadonlyMap<string, DossierClassement>,
  classeLocalement?: string,
): EncartClassement {
  if (classeLocalement !== undefined) {
    return { genre: "classe", dossier: dossiers.get(classeLocalement) ?? null };
  }
  if (mail.etat_classement === "classe") {
    return { genre: "classe", dossier: mail.dossier_id === null ? null : (dossiers.get(mail.dossier_id) ?? null) };
  }
  if (mail.suggestion_dossier_id !== null && mail.suggestion_dossier_id !== "") {
    return {
      genre: "suggestion",
      dossier: dossiers.get(mail.suggestion_dossier_id) ?? null,
      dossierId: mail.suggestion_dossier_id,
    };
  }
  return { genre: "hors-dossier" };
}

/** Texte court du dossier dans une étiquette : sa référence, à défaut son nom. */
export function etiquetteDossier(dossier: Pick<DossierClassement, "nom" | "reference">): string {
  const reference = dossier.reference?.trim() ?? "";
  return reference === "" ? dossier.nom : reference;
}
