import type { NoteFiche } from "@/contacts/historiqueFiche";
import { jourCivilParis } from "@/contacts/registreFiche";
import { libelleDuMembre, type LigneUtilisateur } from "@/identite/libelleMembre";
import { formatDateActe } from "@/lib/format";

/** Note telle que la base locale la porte (`contact_notes`). */
export type NoteLue = {
  id: string;
  texte: string;
  auteur_id: string | null;
  modifie_le: string | null;
  cree_le: string | null;
};

function dateEnToutesLettres(instant: string | null): string {
  const jour = jourCivilParis(instant);
  return jour === null ? "" : formatDateActe(jour);
}

/**
 * Signature d'une note : « Modifié par Me Julien Marchal le 14 octobre 2026 ». L'auteur est `auteur_id`
 * résolu dans `utilisateurs` par le module de libellé ; la date est `modifie_le` (à défaut `cree_le`), au jour
 * civil de Paris. Un auteur absent de la base locale ou une note antérieure à l'identité n'a pas de nom inventé :
 * « Modifié le … ». Rien du tout quand ni l'auteur ni la date ne sont connus.
 */
export function signatureNote(note: NoteLue, membres: ReadonlyMap<string, LigneUtilisateur>): string | null {
  const auteur = libelleDuMembre(membres, note.auteur_id);
  const date = dateEnToutesLettres(note.modifie_le) || dateEnToutesLettres(note.cree_le);
  if (auteur === null && date === "") return null;
  const par = auteur === null ? "" : ` par ${auteur}`;
  const le = date === "" ? "" : ` le ${date}`;
  return `Modifié${par}${le}`;
}

/** Notes prêtes à afficher : texte et signature. */
export function notesAffichees(notes: readonly NoteLue[], membres: ReadonlyMap<string, LigneUtilisateur>): NoteFiche[] {
  return notes.map((note) => ({ id: note.id, texte: note.texte, signature: signatureNote(note, membres) }));
}
