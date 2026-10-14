import { composantesAffichees } from "@/agenda/fuseauParis";
import { normaliserHorodatage } from "@/messagerie/listeMails";
import { analyserCorrespondant } from "@/messagerie/expediteurs";
import { formatDateLongue, formatHeureMur } from "@/lib/format";
import type { ReponseInvitation } from "@/messagerie/reponseInvitation";
import type { InvitationLocale, MailLocal } from "@/messagerie/typesMails";

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] as const;

/** Préfixes ajoutés à l'objet par les clients mail (comparés sans accent ni casse). */
const PREFIXES =
  /^(?:(?:re|tr|fwd?|invitation|mise a jour|annulation|annule|updated invitation|canceled|cancelled)\s*:\s*)+/u;

/** Objet comparable : sans accent ni casse, sans préfixes de réponse, de transfert ou d'invitation. */
export function normaliserObjet(objet: string | null | undefined): string {
  return (objet ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(PREFIXES, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Chemin de la route de réponse à une invitation (`POST /messagerie/invitations/{id}/reponse`). */
export function cheminReponseInvitation(invitationId: string): string {
  return `/messagerie/invitations/${encodeURIComponent(invitationId)}/reponse`;
}

/**
 * Réponse déjà envoyée pour la version courante de l'invitation, d'après la colonne `reponse` synchronisée
 * (`accepte`, `refuse`, `peut_etre`). Le serveur la remet à vide quand une SEQUENCE plus récente arrive : il faut
 * alors répondre à la nouvelle version. `undefined` : pas de réponse (ou valeur inconnue, jamais devinée).
 */
export function reponseEnvoyee(reponse: string | null | undefined): ReponseInvitation | undefined {
  switch ((reponse ?? "").trim()) {
    case "accepte":
      return "accepter";
    case "refuse":
      return "refuser";
    case "peut_etre":
      return "peut_etre";
    default:
      return undefined;
  }
}

function adresseOrganisateur(organisateur: string): string {
  const sans = organisateur.trim().replace(/^mailto:/iu, "");
  return analyserCorrespondant(sans).adresse.toLowerCase();
}

/**
 * Invitation portée par un message.
 *
 * La ligne d'invitation garde le Message-ID du dernier message qui l'a créée ou mise à jour (`message_id`) : c'est
 * le lien exact avec le message. Les lignes qui n'ont pas ce lien (créées avant la migration 040) et les versions
 * antérieures d'une invitation se rapprochent à l'ancienne : un message porte l'invitation de même objet (préfixes
 * « Invitation : », « Re : », « Mise à jour : » ignorés) dont l'organisateur est son expéditeur, la plus récente
 * (SEQUENCE) l'emportant.
 */
export function invitationDuMessage(
  mail: Pick<MailLocal, "objet" | "expediteur"> & { message_id?: string | null },
  invitations: readonly InvitationLocale[],
): InvitationLocale | null {
  const identifiant = (mail.message_id ?? "").trim();
  if (identifiant !== "") {
    const exacte = invitations.find((invitation) => (invitation.message_id ?? "").trim() === identifiant);
    if (exacte !== undefined) return exacte;
  }
  const objetMail = normaliserObjet(mail.objet);
  const expediteur = analyserCorrespondant(mail.expediteur).adresse.toLowerCase();
  if (objetMail === "" || expediteur === "") return null;
  let retenue: InvitationLocale | null = null;
  for (const invitation of invitations) {
    const objetInvitation = normaliserObjet(invitation.objet);
    if (objetInvitation === "" || adresseOrganisateur(invitation.organisateur) !== expediteur) continue;
    if (objetInvitation !== objetMail) continue;
    if (retenue === null || (invitation.sequence ?? 0) > (retenue.sequence ?? 0)) retenue = invitation;
  }
  return retenue;
}

export type PresentationInvitation = {
  /** « oct. » */
  mois: string;
  /** « 8 » (« 1er » pour le premier du mois). */
  jour: string;
  titre: string;
  /** « jeudi 8 octobre, 10 h à 11 h » */
  quand: string;
  organisateur: string;
  annulee: boolean;
  miseAJour: boolean;
};

function quantieme(jour: string): string {
  const n = Number(jour.slice(8, 10));
  return n === 1 ? "1er" : String(n);
}

/**
 * Jour et heures d'une invitation. Une valeur avec décalage est ramenée à l'heure de Paris ; une valeur sans
 * décalage est l'heure du fuseau de l'invitation : elle est affichée telle quelle, suivie du nom du fuseau
 * quand ce n'est pas Europe/Paris.
 */
export function quandInvitation(
  debut: string,
  fin: string | null,
  fuseau: string | null,
): { jour: string; texte: string } | null {
  const mur = composantesAffichees(normaliserHorodatage(debut));
  if (mur === null) return null;
  const heureDebut =
    mur.heure === null || mur.minute === null ? "" : formatHeureMur(mur.heure, mur.minute);
  let heureFin = "";
  if (fin !== null && fin.trim() !== "") {
    const murFin = composantesAffichees(normaliserHorodatage(fin));
    if (murFin !== null && murFin.jour === mur.jour && murFin.heure !== null && murFin.minute !== null) {
      heureFin = formatHeureMur(murFin.heure, murFin.minute);
    }
  }
  const sansDecalage = !/(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/u.test(normaliserHorodatage(debut));
  const etranger = sansDecalage && fuseau !== null && fuseau.trim() !== "" && fuseau.trim() !== "Europe/Paris";
  const horaires = heureDebut === "" ? "" : heureFin === "" ? heureDebut : `${heureDebut} à ${heureFin}`;
  const fuseauTexte = etranger && horaires !== "" ? ` (heure du fuseau ${fuseau.trim()})` : "";
  const texte = `${formatDateLongue(mur.jour)}${horaires === "" ? "" : `, ${horaires}`}${fuseauTexte}`;
  return { jour: mur.jour, texte };
}

export function presenterInvitation(invitation: InvitationLocale): PresentationInvitation | null {
  const quand = quandInvitation(invitation.debut, invitation.fin, invitation.fuseau);
  if (quand === null) return null;
  const organisateur = invitation.organisateur.trim().replace(/^mailto:/iu, "");
  const correspondant = analyserCorrespondant(organisateur);
  const nomOrganisateur = correspondant.nom !== "" ? correspondant.nom : correspondant.adresse;
  return {
    mois: MOIS_COURTS[Number(quand.jour.slice(5, 7)) - 1] ?? "",
    jour: quantieme(quand.jour),
    titre: (invitation.objet ?? "").trim() === "" ? "(sans titre)" : (invitation.objet ?? "").trim(),
    quand: quand.texte,
    organisateur: nomOrganisateur === "" ? "" : `Organisateur : ${nomOrganisateur}`,
    annulee: invitation.effet === "annulation",
    miseAJour: invitation.effet === "mise_a_jour",
  };
}
