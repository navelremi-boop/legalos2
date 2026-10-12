/**
 * Noms des dossiers IMAP affichés en français (maquette prototype-mails, § 3.8.1).
 * Les serveurs nomment les dossiers à leur façon (INBOX, Sent, Éléments envoyés, [Gmail]/Corbeille…) :
 * une table de correspondance les ramène à une clé stable et à un libellé français.
 */

export type CleDossierImap =
  | "reception"
  | "brouillons"
  | "envoyes"
  | "archives"
  | "corbeille"
  | "indesirables";

export type DossierImap = {
  /** Clé stable : une des clés connues, ou le nom normalisé du dossier inconnu. */
  cle: string;
  libelle: string;
  connu: boolean;
};

const LIBELLES: Record<CleDossierImap, string> = {
  reception: "Boîte de réception",
  brouillons: "Brouillons",
  envoyes: "Envoyés",
  archives: "Archives",
  corbeille: "Corbeille",
  indesirables: "Courrier indésirable",
};

/** Ordre d'affichage des dossiers connus dans le rail. */
export const ORDRE_DOSSIERS: readonly CleDossierImap[] = [
  "reception",
  "brouillons",
  "envoyes",
  "archives",
  "corbeille",
  "indesirables",
];

/** Dossiers toujours présents dans la boîte nominative, même vides. */
export const DOSSIERS_TOUJOURS_AFFICHES: readonly CleDossierImap[] = [
  "reception",
  "brouillons",
  "envoyes",
  "archives",
];

/** Noms IMAP usuels (déjà normalisés : minuscules, sans accent) vers la clé stable. */
const CORRESPONDANCE: ReadonlyMap<string, CleDossierImap> = new Map<string, CleDossierImap>([
  ["inbox", "reception"],
  ["boite de reception", "reception"],
  ["boite reception", "reception"],
  ["sent", "envoyes"],
  ["sent items", "envoyes"],
  ["sent mail", "envoyes"],
  ["sent messages", "envoyes"],
  ["envoyes", "envoyes"],
  ["elements envoyes", "envoyes"],
  ["messages envoyes", "envoyes"],
  ["drafts", "brouillons"],
  ["draft", "brouillons"],
  ["brouillons", "brouillons"],
  ["brouillon", "brouillons"],
  ["archive", "archives"],
  ["archives", "archives"],
  ["archived", "archives"],
  ["all mail", "archives"],
  ["trash", "corbeille"],
  ["deleted", "corbeille"],
  ["deleted items", "corbeille"],
  ["deleted messages", "corbeille"],
  ["bin", "corbeille"],
  ["corbeille", "corbeille"],
  ["elements supprimes", "corbeille"],
  ["junk", "indesirables"],
  ["junk email", "indesirables"],
  ["junk e mail", "indesirables"],
  ["spam", "indesirables"],
  ["bulk mail", "indesirables"],
  ["courrier indesirable", "indesirables"],
  ["indesirables", "indesirables"],
]);

function normaliser(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dernier segment du chemin IMAP (« INBOX.Sent », « [Gmail]/Sent Mail », « INBOX/Archive »). */
function dernierSegment(nom: string): string {
  const segments = nom.split(/[/.]/).map((segment) => segment.trim());
  const utiles = segments.filter((segment) => segment !== "");
  return utiles[utiles.length - 1] ?? "";
}

/**
 * Dossier IMAP d'un message. Un nom vide ou absent vaut la boîte de réception (valeur par défaut
 * du serveur). Un dossier inconnu garde son nom, sans le chemin qui le précède.
 */
export function dossierImap(nom: string | null | undefined): DossierImap {
  const brut = (nom ?? "").trim();
  if (brut === "") return { cle: "reception", libelle: LIBELLES.reception, connu: true };
  const segment = dernierSegment(brut);
  const normalise = normaliser(segment === "" ? brut : segment);
  const cle = CORRESPONDANCE.get(normalise);
  if (cle !== undefined) return { cle, libelle: LIBELLES[cle], connu: true };
  return { cle: normalise, libelle: segment === "" ? brut : segment, connu: false };
}

/** Libellé français d'une clé connue. */
export function libelleDossierImap(cle: CleDossierImap): string {
  return LIBELLES[cle];
}
