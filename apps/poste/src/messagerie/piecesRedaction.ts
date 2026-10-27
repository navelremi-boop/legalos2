import { fr } from "@/lib/fr";

/**
 * Pièces jointes d'un brouillon : limites annoncées à l'écran, vérifications avant téléversement, résumé
 * synchronisé. Les limites sont celles de l'API (25 Mio cumulés, 50 pièces, nom de 255 caractères au plus) ;
 * le serveur les refuse aussi, l'écran les annonce et les applique avant d'envoyer des octets.
 */

export const TAILLE_MAX_CUMULEE = 25 * 1024 * 1024;
export const NOMBRE_MAX_PIECES = 50;
export const LONGUEUR_MAX_NOM = 255;

/** Résumé d'une pièce tel que le serveur le synchronise (jamais le contenu). */
export type PieceBrouillon = { id: string; nom: string; type_mime: string; taille: number };

/** Pièce affichée : celles du brouillon, plus celles qu'un transfert garde et que le serveur n'a pas encore résumées. */
export type PieceAffichee = {
  cle: string;
  /** Identifiant serveur ; `null` tant que la pièce n'est pas encore connue du serveur. */
  id: string | null;
  nom: string;
  taille: number | null;
  etat: "jointe" | "en-cours" | "conservee" | "refusee";
  message?: string;
};

const NBSP = " ";

/** Taille lisible en français : « 850 Kio », « 2,4 Mio » (la virgule est décimale). */
export function formatTaille(octets: number): string {
  const n = Math.max(0, Math.floor(octets));
  if (n < 1024) return `${String(n)}${NBSP}o`;
  const kio = n / 1024;
  if (kio < 1024) return `${String(Math.max(1, Math.round(kio)))}${NBSP}Kio`;
  const mio = kio / 1024;
  const arrondi = Math.round(mio * 10) / 10;
  const texte = Number.isInteger(arrondi) ? String(arrondi) : String(arrondi).replace(".", ",");
  return `${texte}${NBSP}Mio`;
}

/** Phrase qui annonce la taille maximale, sous le champ des pièces. */
export function annonceTailleMax(): string {
  return fr(`Pièces jointes : ${formatTaille(TAILLE_MAX_CUMULEE)} au plus par message, ajoutées en ligne.`);
}

/** Pièces d'une valeur JSON déjà lue (réponse de l'API ou colonne décodée). Les éléments illisibles sont ignorés. */
export function piecesDepuisValeur(valeur: unknown): PieceBrouillon[] {
  if (!Array.isArray(valeur)) return [];
  const pieces: PieceBrouillon[] = [];
  for (const element of valeur as unknown[]) {
    if (typeof element !== "object" || element === null) continue;
    const ligne = element as Record<string, unknown>;
    if (typeof ligne.id !== "string" || typeof ligne.nom !== "string") continue;
    pieces.push({
      id: ligne.id,
      nom: ligne.nom,
      type_mime: typeof ligne.type_mime === "string" ? ligne.type_mime : "application/octet-stream",
      taille: typeof ligne.taille === "number" && Number.isFinite(ligne.taille) ? ligne.taille : 0,
    });
  }
  return pieces;
}

function memesIdentifiants(a: readonly PieceBrouillon[], b: readonly PieceBrouillon[]): boolean {
  const ids = (pieces: readonly PieceBrouillon[]) =>
    pieces
      .map((piece) => piece.id)
      .sort()
      .join("\0");
  return ids(a) === ids(b);
}

/**
 * Le cliché local (`pieces_texte`) arrive par la synchronisation, donc après la réponse de l'API
 * qui vient d'ajouter ou de retirer une pièce. Tant qu'il ne porte pas les mêmes identifiants,
 * il ne remplace pas la liste déjà affichée : la pièce disparaîtrait de l'écran. Une fois aligné,
 * le cliché reprend la main, suppression depuis un autre poste comprise.
 */
export function concilierPiecesLocales(
  affichees: readonly PieceBrouillon[],
  locales: readonly PieceBrouillon[],
  tenir: boolean,
): { pieces: PieceBrouillon[]; tenir: boolean } {
  if (!tenir || memesIdentifiants(affichees, locales)) {
    return { pieces: [...locales], tenir: false };
  }
  return { pieces: [...affichees], tenir: true };
}

/** Lecture du résumé JSON des pièces (colonne pieces_texte). Une valeur illisible vaut « aucune pièce ». */
export function lirePiecesBrouillon(texte: string | null | undefined): PieceBrouillon[] {
  if (texte === null || texte === undefined || texte.trim() === "") return [];
  try {
    return piecesDepuisValeur(JSON.parse(texte));
  } catch {
    return [];
  }
}

export function tailleCumulee(pieces: readonly Pick<PieceBrouillon, "taille">[]): number {
  return pieces.reduce((somme, piece) => somme + piece.taille, 0);
}

export type VerificationAjout = { ok: true } | { ok: false; message: string };

/** Nom de fichier sûr : ni séparateur de chemin ni caractère de contrôle, 255 caractères au plus. */
export function nomPieceValide(nom: string): boolean {
  const propre = nom.trim();
  return (
    propre !== "" &&
    Array.from(propre).length <= LONGUEUR_MAX_NOM &&
    !/[\\/]/u.test(propre) &&
    !/\p{Cc}/u.test(propre)
  );
}

/**
 * Un fichier peut-il être ajouté ? Refus avec une phrase qui dit pourquoi, avant tout envoi d'octets :
 * fichier vide, nom invalide, trop de pièces, ou taille cumulée supérieure au maximum.
 */
export function verifierAjout(
  existantes: readonly Pick<PieceBrouillon, "taille">[],
  fichier: { nom: string; taille: number },
): VerificationAjout {
  if (fichier.taille <= 0) return { ok: false, message: `« ${fichier.nom} » est vide.` };
  if (!nomPieceValide(fichier.nom)) {
    return { ok: false, message: `Le nom de « ${fichier.nom.slice(0, 40)} » n'est pas valable pour une pièce jointe.` };
  }
  if (existantes.length >= NOMBRE_MAX_PIECES) {
    return { ok: false, message: `Trop de pièces jointes : ${String(NOMBRE_MAX_PIECES)} au plus.` };
  }
  if (tailleCumulee(existantes) + fichier.taille > TAILLE_MAX_CUMULEE) {
    return {
      ok: false,
      message: `« ${fichier.nom} » dépasse la taille maximale : ${formatTaille(TAILLE_MAX_CUMULEE)} cumulés par message.`,
    };
  }
  return { ok: true };
}

/** Extension en capitales d'un nom de fichier (« PDF »), vide s'il n'en a pas. */
export function extensionDe(nom: string): string {
  const point = nom.lastIndexOf(".");
  if (point <= 0 || point === nom.length - 1) return "";
  const extension = nom.slice(point + 1);
  return extension.length > 5 ? "" : extension.toLocaleUpperCase("fr");
}

/**
 * Pièces à montrer. Celles du brouillon d'abord ; un transfert dont le serveur n'a pas encore résumé les
 * pièces (brouillon écrit hors ligne, pas encore envoyé) montre celles du message d'origine comme conservées.
 */
export function piecesAffichees(
  brouillon: readonly PieceBrouillon[],
  genre: string,
  piecesDuMessage: readonly string[],
  enCours: readonly PieceAffichee[],
): PieceAffichee[] {
  const jointes: PieceAffichee[] = brouillon.map((piece) => ({
    cle: piece.id,
    id: piece.id,
    nom: piece.nom,
    taille: piece.taille,
    etat: "jointe",
  }));
  const conservees: PieceAffichee[] =
    genre === "transfert" && brouillon.length === 0 && enCours.length === 0
      ? piecesDuMessage.map((nom, index) => ({
          cle: `origine-${String(index)}-${nom}`,
          id: null,
          nom,
          taille: null,
          etat: "conservee" as const,
        }))
      : [];
  return [...jointes, ...conservees, ...enCours];
}
