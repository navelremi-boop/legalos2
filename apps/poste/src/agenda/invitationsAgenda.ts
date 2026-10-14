import { composantesAffichees, murParis } from "@/agenda/fuseauParis";
import { formatHeureMur } from "@/lib/format";
import { analyserCorrespondant } from "@/messagerie/expediteurs";
import { normaliserHorodatage } from "@/messagerie/listeMails";
import type { InvitationLocale } from "@/messagerie/typesMails";

/**
 * Invitations reçues par mail, telles que l'écran Agenda les montre (cahier des charges § 2.3 : invitations
 * reflétées dans l'agenda du seul titulaire). Fonctions pures : la lecture de la table `invitations_agenda`
 * (déjà limitée à son titulaire par les flux de synchronisation) est dans `donneesInvitations.ts`, aucune écriture
 * dans `agenda_elements`.
 *
 * Une ligne par UID : la version courante (dernière SEQUENCE). Une mise à jour déplace l'élément, une annulation
 * le laisse en place, marqué annulé.
 */

export type ReponseAgenda = "accepte" | "refuse" | "peut_etre" | "a_repondre";

export type ElementInvitation = {
  id: string;
  uid: string;
  /** Jour local (AAAA-MM-JJ, Europe/Paris, comme tout l'agenda). */
  jour: string;
  /** Minutes depuis minuit à l'heure locale ; `null` : journée entière ou jour sans heure. */
  minutes: number | null;
  /** « 10 h 00 » ; vide pour une journée entière. */
  heure: string;
  titre: string;
  effet: "demande" | "mise_a_jour" | "annulation";
  annulee: boolean;
  miseAJour: boolean;
  reponse: ReponseAgenda;
  /** Faux : le mail qui porte la version courante ne vient pas de l'organisateur annoncé. */
  verifiee: boolean;
  organisateur: string;
  /** Fuseau de l'invitation quand son heure n'a pas pu être convertie à l'heure locale (fuseau inconnu, heure flottante). */
  fuseauNonConverti: string | null;
  /** Message-ID du message qui porte la version courante ; `null` : lien inconnu. */
  messageId: string | null;
};

export type PresentationInvitationAgenda = {
  /** « Invitation — Objet » */
  libelle: string;
  heure: string;
  /** « Annulée », « Mise à jour » ou rien. */
  etat: string | null;
  /** « Accepté », « Refusé », « Peut-être », « À répondre » ; rien pour une invitation annulée. */
  reponse: string | null;
  /** « Origine non vérifiée » quand le doute existe. */
  avertissement: string | null;
  organisateur: string;
  fuseau: string | null;
};

const EFFETS = new Set<string>(["demande", "mise_a_jour", "annulation"]);

function reponseDe(brut: string | null | undefined): ReponseAgenda {
  switch ((brut ?? "").trim()) {
    case "accepte":
      return "accepte";
    case "refuse":
      return "refuse";
    case "peut_etre":
      return "peut_etre";
    default:
      return "a_repondre";
  }
}

function estVrai(valeur: number | boolean | null | undefined): boolean {
  return valeur === true || (typeof valeur === "number" && valeur !== 0);
}

type MomentLocal = { jour: string; heure: number | null; minute: number | null; converti: boolean };

/**
 * Jour et heure locaux du début. L'instant UTC déduit par le serveur (`debut_utc`) est ramené à l'heure de Paris,
 * y compris au passage à l'heure d'hiver ou d'été. Sans instant (journée entière, heure flottante, fuseau inconnu),
 * l'heure civile est affichée telle quelle : aucun instant n'est inventé.
 */
function debutLocal(invitation: InvitationLocale): MomentLocal | null {
  const utc = (invitation.debut_utc ?? "").trim();
  if (utc !== "" && !Number.isNaN(new Date(utc).getTime())) {
    const mur = murParis(new Date(utc).toISOString());
    return { jour: mur.jour, heure: Number(mur.heure), minute: Number(mur.minute), converti: true };
  }
  const civil = composantesAffichees(normaliserHorodatage(invitation.debut));
  return civil === null ? null : { ...civil, converti: false };
}

function organisateurLisible(organisateur: string): string {
  const adresse = organisateur.trim().replace(/^mailto:/iu, "");
  const correspondant = analyserCorrespondant(adresse);
  return correspondant.nom !== "" ? correspondant.nom : correspondant.adresse;
}

/** Une invitation devient un élément d'agenda ; `null` quand son début est illisible. */
export function elementInvitation(invitation: InvitationLocale): ElementInvitation | null {
  const debut = debutLocal(invitation);
  if (debut === null) return null;
  const effet = EFFETS.has(invitation.effet) ? (invitation.effet as ElementInvitation["effet"]) : "demande";
  const avecHeure = debut.heure !== null && debut.minute !== null;
  const fuseau = (invitation.fuseau ?? "").trim();
  const etranger = !debut.converti && avecHeure && fuseau !== "" && fuseau !== "Europe/Paris";
  const titre = (invitation.objet ?? "").trim();
  return {
    id: invitation.id,
    uid: invitation.uid_ical,
    jour: debut.jour,
    minutes: avecHeure ? (debut.heure ?? 0) * 60 + (debut.minute ?? 0) : null,
    heure: avecHeure ? formatHeureMur(debut.heure ?? 0, debut.minute ?? 0) : "",
    titre: titre === "" ? "(sans titre)" : titre,
    effet,
    annulee: effet === "annulation",
    miseAJour: effet === "mise_a_jour",
    reponse: reponseDe(invitation.reponse),
    verifiee: estVrai(invitation.verifiee),
    organisateur: organisateurLisible(invitation.organisateur),
    fuseauNonConverti: etranger ? fuseau : null,
    messageId: (invitation.message_id ?? "").trim() === "" ? null : (invitation.message_id ?? "").trim(),
  };
}

/** Éléments de toutes les invitations : une par UID (la plus grande SEQUENCE), début illisible écarté. */
export function elementsInvitations(invitations: readonly InvitationLocale[]): ElementInvitation[] {
  const courantes = new Map<string, InvitationLocale>();
  for (const invitation of invitations) {
    const deja = courantes.get(invitation.uid_ical);
    if (deja === undefined || (invitation.sequence ?? 0) >= (deja.sequence ?? 0)) {
      courantes.set(invitation.uid_ical, invitation);
    }
  }
  return [...courantes.values()].flatMap((invitation) => {
    const element = elementInvitation(invitation);
    return element === null ? [] : [element];
  });
}

/** Invitations d'un jour local : la journée entière d'abord, puis par heure, puis par titre. */
export function invitationsDuJour(elements: readonly ElementInvitation[], jour: string): ElementInvitation[] {
  return elements
    .filter((element) => element.jour === jour)
    .sort((a, b) => {
      if (a.minutes !== b.minutes) {
        if (a.minutes === null) return -1;
        if (b.minutes === null) return 1;
        return a.minutes - b.minutes;
      }
      return a.titre.localeCompare(b.titre, "fr");
    });
}

const LIBELLES_REPONSE: Record<ReponseAgenda, string> = {
  accepte: "Accepté",
  refuse: "Refusé",
  peut_etre: "Peut-être",
  a_repondre: "À répondre",
};

export function presenterInvitationAgenda(element: ElementInvitation): PresentationInvitationAgenda {
  return {
    libelle: `Invitation — ${element.titre}`,
    heure: element.heure,
    etat: element.annulee ? "Annulée" : element.miseAJour ? "Mise à jour" : null,
    reponse: element.annulee ? null : LIBELLES_REPONSE[element.reponse],
    avertissement: element.verifiee ? null : "Origine non vérifiée",
    organisateur: element.organisateur === "" ? "" : `Organisateur : ${element.organisateur}`,
    fuseau: element.fuseauNonConverti === null ? null : `heure du fuseau ${element.fuseauNonConverti}`,
  };
}
