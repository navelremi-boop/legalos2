import { depuisLignes, formeEnTete } from "@/messagerie/adressesRedaction";
import { texteDepuisHtml } from "@/messagerie/nettoyageHtml";
import { lirePiecesBrouillon } from "@/messagerie/piecesRedaction";
import type { LigneBrouillon } from "@/messagerie/etatRedaction";
import type { MailLocal } from "@/messagerie/typesMails";

/**
 * Les brouillons dans la liste des mails. Un brouillon de la base locale prend la forme d'une ligne de mail du
 * dossier Brouillons de l'utilisateur : même liste, mêmes groupes par jour, même sélection. Le volet de droite
 * rouvre alors la rédaction au lieu de la lecture.
 */

/** Texte saisi, sans l'historique cité (la citation commence au premier bloc de citation). */
export function debutDeSaisie(corpsHtml: string | null | undefined): string {
  const html = corpsHtml ?? "";
  const citation = html.search(/<blockquote\b/iu);
  const saisie = citation === -1 ? html : html.slice(0, citation);
  return texteDepuisHtml(saisie);
}

/** Ligne de la liste pour un brouillon. `monId` est l'identifiant de l'utilisateur (boîte « perso »). */
export function brouillonVersMail(ligne: LigneBrouillon, monId: string | null): MailLocal {
  const destinataires = [...depuisLignes(ligne.a), ...depuisLignes(ligne.cc), ...depuisLignes(ligne.cci)];
  const noms = destinataires.map(formeEnTete);
  const pieces = lirePiecesBrouillon(ligne.pieces_texte).map((piece) => piece.nom);
  return {
    id: ligne.id,
    message_id: null,
    objet: ligne.objet ?? "",
    expediteur: noms[0] ?? "",
    destinataires_texte: noms.join(", "),
    pieces_texte: pieces.join("\n"),
    extrait_texte: null,
    debut_texte: debutDeSaisie(ligne.corps_html).slice(0, 240),
    etat_classement: null,
    dossier_id: ligne.dossier_id,
    suggestion_dossier_id: null,
    titulaire_id: monId,
    lu: 1,
    dossier_imap: "Drafts",
    cree_le: ligne.modifie_le ?? ligne.cree_le,
    brouillon: true,
  };
}

export function brouillonsVersMails(lignes: readonly LigneBrouillon[], monId: string | null): MailLocal[] {
  return lignes.map((ligne) => brouillonVersMail(ligne, monId));
}

/** Nom affiché en tête de ligne d'un brouillon : « À Me Anne Perrin », ou « Sans destinataire ». */
export function nomLigneBrouillon(destinataires: string): string {
  return destinataires.trim() === "" ? "Sans destinataire" : `À ${destinataires.trim()}`;
}
