import { formatDateActe } from "@/lib/format";
import { majusculeInitiale } from "@/contacts/listeContacts";

/**
 * Textes de la fiche en lecture (onglet Général), d'après la maquette `prototype-contacts.html`.
 * Affichage seulement : les valeurs stockées, et la désignation dans les actes, restent celles de la saisie.
 */

export type NaissanceLecture = {
  /** Texte de la valeur, sous « Né le » ou « Née le ». */
  texte: string;
  /** Vrai quand la date manque : la ligne prend le style des mentions à compléter. */
  manque: boolean;
};

function lieuNet(lieu: string | null | undefined): string {
  return (lieu ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * Date puis lieu de naissance : « 3 février 1972 à Saint-Étienne (Loire) ».
 * Le lieu se lit tel qu'il a été saisi : le département n'est pas une donnée distincte,
 * il figure entre parenthèses dans le lieu quand l'avocat l'a écrit (« Lyon (Rhône) »).
 * Sans lieu, la date seule ; sans date, une mention à compléter qui garde le lieu ; sans l'un ni l'autre, null.
 */
export function naissanceLecture(
  dateNaissance: string | null | undefined,
  lieuNaissance: string | null | undefined,
): NaissanceLecture | null {
  const date = dateNaissance ? formatDateActe(dateNaissance) : "";
  const lieu = lieuNet(lieuNaissance);
  if (date !== "" && lieu !== "") return { texte: `${date} à ${lieu}`, manque: false };
  if (date !== "") return { texte: date, manque: false };
  if (lieu !== "") return { texte: `Date non renseignée, à ${lieu}`, manque: true };
  return null;
}

/** Valeur d'état civil à la majuscule initiale (« française » s'affiche « Française »), ou null si vide. */
export function valeurEtatCivil(valeur: string | null | undefined): string | null {
  const nette = valeur?.trim() ?? "";
  return nette === "" ? null : majusculeInitiale(nette);
}

/** « Cour d'appel de Lyon », « Cour d'appel d'Aix-en-Provence » : valeur de la ligne « Ressort ». */
export function ressortLecture(courAppel: string | null | undefined): string | null {
  const nom = (courAppel ?? "").replace(/\s+/gu, " ").trim();
  if (nom === "") return null;
  const elision = /^[AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜŒ]/iu.test(nom);
  return `Cour d'appel ${elision ? "d'" : "de "}${nom}`;
}
