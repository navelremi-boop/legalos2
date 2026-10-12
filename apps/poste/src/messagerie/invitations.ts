import { composantesAffichees } from "@/agenda/fuseauParis";
import { normaliserHorodatage } from "@/messagerie/listeMails";
import { analyserCorrespondant } from "@/messagerie/expediteurs";
import { formatDateLongue, formatHeureMur } from "@/lib/format";
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

function adresseOrganisateur(organisateur: string): string {
  const sans = organisateur.trim().replace(/^mailto:/iu, "");
  return analyserCorrespondant(sans).adresse.toLowerCase();
}

/**
 * Invitation portée par un message.
 *
 * La base locale ne relie pas encore une invitation à son message : `invitations_agenda` n'a ni identifiant de
 * message ni UID dans `messages`. En attendant ce lien (étape 2 du jalon), un message porte l'invitation de même
 * objet (préfixes « Invitation : », « Re : », « Mise à jour : » ignorés) dont l'organisateur est son expéditeur.
 * Quand l'invitation a eu plusieurs versions (SEQUENCE), la plus récente est retenue.
 * Seule cette fonction change quand le lien existe.
 */
export function invitationDuMessage(
  mail: Pick<MailLocal, "objet" | "expediteur">,
  invitations: readonly InvitationLocale[],
): InvitationLocale | null {
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
