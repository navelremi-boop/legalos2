import { composantesAffichees, murParis } from "@/agenda/fuseauParis";
import { estLu } from "@/messagerie/classement";
import type { MailLocal } from "@/messagerie/typesMails";
import { formatDateCourte, formatDateLongue, formatHeureMur } from "@/lib/format";

export type FiltreListe = "tous" | "nonlus" | "pj";

export type GroupeJour = {
  /** Clé stable du groupe (« aujourdhui », « hier », « semaine », « mois », « 2026-09 »). */
  cle: string;
  titre: string;
  mails: MailLocal[];
};

type MurMail = { jour: string; heure: number | null; minute: number | null };

/**
 * Horodatage d'un message vers une forme que `composantesAffichees` comprend.
 * Postgres rend `2026-10-12 09:12:34.123+00` (espace, décalage sur deux chiffres) ; une valeur sans décalage
 * est déjà une heure murale.
 */
export function normaliserHorodatage(valeur: string): string {
  const brut = valeur.trim();
  const trouve = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/u.exec(brut);
  if (!trouve) return brut;
  const date = trouve[1] ?? "";
  const heure = trouve[2] ?? "";
  const decalage = trouve[3] ?? "";
  if (decalage === "") return `${date}T${heure}`;
  if (decalage === "Z") return `${date}T${heure}Z`;
  const signe = decalage.slice(0, 1);
  const chiffres = decalage.slice(1).replace(":", "");
  const hh = chiffres.slice(0, 2);
  const mm = chiffres.length >= 4 ? chiffres.slice(2, 4) : "00";
  return `${date}T${heure}${signe}${hh}:${mm}`;
}

/** Date d'un mail à l'écran et pour le tri : celle de son en-tête, à défaut sa date d'arrivée. */
export function dateDuMail(mail: Pick<MailLocal, "date_entete" | "cree_le">): string | null {
  const entete = mail.date_entete?.trim();
  return entete !== undefined && entete !== "" ? entete : (mail.cree_le ?? null);
}

/** Jour et heure murale (Europe/Paris) d'un horodatage de mail ; `null` s'il est illisible. */
export function muralMail(valeur: string | null | undefined): MurMail | null {
  if (valeur === null || valeur === undefined) return null;
  return composantesAffichees(normaliserHorodatage(valeur));
}

/** Nombre servant seulement à trier : minutes écoulées depuis 1970 du mur Paris. */
function rangMail(valeur: string | null | undefined): number {
  const mur = muralMail(valeur);
  if (mur === null) return 0;
  const [annee, mois, quantieme] = mur.jour.split("-").map(Number);
  const utc = Date.UTC(annee ?? 0, (mois ?? 1) - 1, quantieme ?? 1, mur.heure ?? 0, mur.minute ?? 0);
  return utc;
}

/** Du plus récent au plus ancien ; à égalité, l'ordre d'origine est conservé. */
export function trierParDate(mails: readonly MailLocal[]): MailLocal[] {
  return mails
    .map((mail, index) => ({ mail, index, rang: rangMail(dateDuMail(mail)) }))
    .sort((a, b) => b.rang - a.rang || a.index - b.index)
    .map((entree) => entree.mail);
}

function utcDuJour(jour: string): number {
  const [annee, mois, quantieme] = jour.split("-").map(Number);
  return Date.UTC(annee ?? 0, (mois ?? 1) - 1, quantieme ?? 1);
}

/** Jours civils entre `jour` et `aujourdhui` (positif : `jour` est dans le passé). */
export function ecartEnJours(jour: string, aujourdhui: string): number {
  return Math.round((utcDuJour(aujourdhui) - utcDuJour(jour)) / 86_400_000);
}

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

const JOURS_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."] as const;

/** Jour civil Paris d'un instant. */
export function jourParis(instant: Date): string {
  return murParis(instant.toISOString()).jour;
}

function groupeDe(jour: string, aujourdhui: string): { cle: string; titre: string } {
  const ecart = ecartEnJours(jour, aujourdhui);
  if (ecart <= 0) return { cle: "aujourdhui", titre: "Aujourd'hui" };
  if (ecart === 1) return { cle: "hier", titre: "Hier" };
  if (ecart <= 6) return { cle: "semaine", titre: "Cette semaine" };
  if (jour.slice(0, 7) === aujourdhui.slice(0, 7)) return { cle: "mois", titre: "Ce mois-ci" };
  const mois = Number(jour.slice(5, 7));
  const nom = MOIS[mois - 1] ?? "";
  const titre = `${nom.slice(0, 1).toUpperCase()}${nom.slice(1)} ${jour.slice(0, 4)}`;
  return { cle: jour.slice(0, 7), titre };
}

/** Liste groupée par jour (Aujourd'hui, Hier, Cette semaine, Ce mois-ci, puis par mois), du plus récent au plus ancien. */
export function groupesParJour(mails: readonly MailLocal[], maintenant: Date): GroupeJour[] {
  const aujourdhui = jourParis(maintenant);
  const groupes: GroupeJour[] = [];
  for (const mail of trierParDate(mails)) {
    const mur = muralMail(dateDuMail(mail));
    const { cle, titre } = mur === null ? { cle: "sans-date", titre: "Sans date" } : groupeDe(mur.jour, aujourdhui);
    const dernier = groupes[groupes.length - 1];
    if (dernier?.cle === cle) {
      dernier.mails.push(mail);
    } else {
      groupes.push({ cle, titre, mails: [mail] });
    }
  }
  return groupes;
}

function heureOuVide(mur: MurMail): string {
  return mur.heure === null || mur.minute === null ? "" : formatHeureMur(mur.heure, mur.minute);
}

function jourSemaineCourt(jour: string): string {
  const [annee, mois, quantieme] = jour.split("-").map(Number);
  const numero = new Date(Date.UTC(annee ?? 0, (mois ?? 1) - 1, quantieme ?? 1)).getUTCDay();
  return JOURS_COURTS[numero] ?? "";
}

/**
 * Horodatage d'une ligne de la liste : l'heure pour aujourd'hui et hier, le jour de la semaine
 * (« lun. ») pour les cinq jours d'avant, sinon la date courte (« 1er oct. »).
 */
export function horodatageListe(valeur: string | null | undefined, maintenant: Date): string {
  const mur = muralMail(valeur);
  if (mur === null) return "";
  const ecart = ecartEnJours(mur.jour, jourParis(maintenant));
  if (ecart <= 1) return heureOuVide(mur);
  if (ecart <= 6) return jourSemaineCourt(mur.jour);
  return formatDateCourte(mur.jour);
}

/**
 * Horodatage de l'en-tête de lecture : « Aujourd'hui, 8 h 40 », « Hier, 17 h 20 »,
 * « lundi 5 octobre, 7 h 30 ».
 */
export function horodatageLecture(valeur: string | null | undefined, maintenant: Date): string {
  const mur = muralMail(valeur);
  if (mur === null) return "";
  const ecart = ecartEnJours(mur.jour, jourParis(maintenant));
  const heure = heureOuVide(mur);
  let jour: string;
  if (ecart <= 0) jour = "Aujourd'hui";
  else if (ecart === 1) jour = "Hier";
  else jour = formatDateLongue(mur.jour);
  return heure === "" ? jour : `${jour}, ${heure}`;
}

/** Noms des pièces jointes (une par ligne dans `pieces_texte`). */
export function listePieces(mail: Pick<MailLocal, "pieces_texte">): string[] {
  return (mail.pieces_texte ?? "")
    .split("\n")
    .map((nom) => nom.trim())
    .filter((nom) => nom !== "");
}

export function filtrerMails(mails: readonly MailLocal[], filtre: FiltreListe): MailLocal[] {
  if (filtre === "nonlus") return mails.filter((mail) => !estLu(mail));
  if (filtre === "pj") return mails.filter((mail) => listePieces(mail).length > 0);
  return [...mails];
}

/** Une ligne d'aperçu : début du texte nettoyé, sans retours à la ligne, coupé à 90 caractères. */
export function apercuMail(mail: Pick<MailLocal, "debut_texte" | "extrait_texte">): string {
  const source = (mail.debut_texte ?? "").trim() !== "" ? mail.debut_texte : mail.extrait_texte;
  const texte = (source ?? "").replace(/\s+/gu, " ").trim();
  if (texte === "") return "";
  return texte.length > 90 ? `${texte.slice(0, 90)}…` : texte;
}

/** Extension en capitales d'un nom de fichier (« PDF »), vide s'il n'en a pas. */
export function extensionPiece(nom: string): string {
  const point = nom.lastIndexOf(".");
  if (point <= 0 || point === nom.length - 1) return "";
  const extension = nom.slice(point + 1);
  return extension.length > 5 ? "" : extension.toLocaleUpperCase("fr");
}

/** Paragraphes d'un texte brut (séparés par des lignes vides). */
export function paragraphes(texte: string): string[] {
  return texte
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((paragraphe) => paragraphe.trim())
    .filter((paragraphe) => paragraphe !== "");
}
