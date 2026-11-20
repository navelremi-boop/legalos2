/**
 * Libellé d'un membre du cabinet : module unique, repris tel quel partout où un membre est nommé (auteur d'une
 * note, avocat d'un dossier, diligences, champs de fusion). Il compose le libellé de ce qui a été saisi, jamais
 * d'une valeur déduite : aucune partie de l'adresse e-mail ne devient un nom.
 *
 * - Avocat ou avocat collaborateur : « Me Prénom Nom », pour une avocate comme pour un avocat.
 * - Autre qualité (ou qualité non saisie) : « Mme Prénom Nom » ou « M. Prénom Nom » selon la civilité ; sans
 *   civilité, « Prénom Nom ».
 * - Ni prénom ni nom : l'adresse e-mail seule, et l'invitation « Complétez votre profil » s'affiche.
 *
 * Les codes (`madame`, `monsieur`, `avocat`…) sont ceux que l'API écrit dans `utilisateurs`.
 */

export type MembreCabinet = {
  email?: string | null;
  civilite?: string | null;
  prenom?: string | null;
  nom?: string | null;
  qualite?: string | null;
};

export const QUALITES_AVOCAT: readonly string[] = ["avocat", "avocat_collaborateur"];

/** Texte rogné, espaces internes réduits à un ; vide : `null`. */
function propre(valeur: string | null | undefined): string | null {
  const net = (valeur ?? "").replace(/\s+/g, " ").trim();
  return net === "" ? null : net;
}

/** Vrai pour une qualité d'avocat (Me), quelle que soit la civilité. */
export function estQualiteAvocat(qualite: string | null | undefined): boolean {
  return QUALITES_AVOCAT.includes((qualite ?? "").trim());
}

function civiliteCourteMembre(civilite: string | null | undefined): string | null {
  const code = (civilite ?? "").trim().toLocaleLowerCase("fr");
  if (code === "madame" || code === "mme") return "Mme";
  if (code === "monsieur" || code === "m.") return "M.";
  return null;
}

/** Vrai quand ni le prénom ni le nom ne sont saisis : l'identité du membre reste à compléter. */
export function identiteVide(membre: MembreCabinet): boolean {
  return propre(membre.prenom) === null && propre(membre.nom) === null;
}

/** Vrai quand l'invitation « Complétez votre profil » doit s'afficher (identité vide). */
export function inviterACompleter(membre: MembreCabinet): boolean {
  return identiteVide(membre);
}

/** Texte de l'invitation, affiché là où le libellé se réduit à l'adresse e-mail. */
export const INVITATION_PROFIL = "Complétez votre profil";

export function libelleMembre(membre: MembreCabinet): string {
  const prenom = propre(membre.prenom);
  const nom = propre(membre.nom);
  if (prenom === null && nom === null) return propre(membre.email) ?? "";
  const identite = [prenom, nom].filter((partie): partie is string => partie !== null).join(" ");
  if (estQualiteAvocat(membre.qualite)) return `Me ${identite}`;
  const civilite = civiliteCourteMembre(membre.civilite);
  return civilite === null ? identite : `${civilite} ${identite}`;
}

/** Ligne de la table locale `utilisateurs` (colonnes lues par `lireMembres`). */
export type LigneUtilisateur = {
  id: string;
  email: string | null;
  civilite: string | null;
  prenom: string | null;
  nom: string | null;
  qualite: string | null;
  actif: number | null;
};

/** Membres indexés par identifiant, pour résoudre un `auteur_id` ou un responsable en libellé. */
export function indexerMembres(lignes: readonly LigneUtilisateur[]): ReadonlyMap<string, LigneUtilisateur> {
  return new Map(lignes.map((ligne) => [ligne.id, ligne]));
}

/**
 * Libellé du membre `id` dans l'index ; `null` quand le membre n'est pas (encore) dans la base locale,
 * pour que l'appelant n'affiche rien plutôt qu'un nom inventé.
 */
export function libelleDuMembre(membres: ReadonlyMap<string, LigneUtilisateur>, id: string | null): string | null {
  if (id === null) return null;
  const ligne = membres.get(id);
  if (ligne === undefined) return null;
  const libelle = libelleMembre(ligne);
  return libelle === "" ? null : libelle;
}

/** Membres actifs (colonne `actif` à 1), triés par libellé en ordre alphabétique français. */
export function membresActifs(lignes: readonly LigneUtilisateur[]): LigneUtilisateur[] {
  return lignes
    .filter((ligne) => ligne.actif === 1)
    .sort((a, b) =>
      libelleMembre(a).localeCompare(libelleMembre(b), "fr", { sensitivity: "base", numeric: true }),
    );
}
