import { boiteDuMessage, type IdBoite } from "@/messagerie/boitesMail";
import { fr } from "@/lib/fr";
import type { CompteLocal } from "@/messagerie/typesMails";

/**
 * Notification de bureau à l'arrivée d'un mail : la décision d'émettre, sans accès à la base ni au système.
 *
 * Le serveur numérote chaque message à son insertion (`arrivee_seq`, croissant, jamais modifié) et marque
 * `arrivee_notifiable` les seuls messages arrivés dans la réception d'une boîte déjà relevée, encore non lus
 * (jamais la première relève ni un changement d'UIDVALIDITY : c'est de l'historique). Le poste ne compare pas les
 * horloges : il garde, par utilisateur et par boîte, le plus grand rang déjà traité.
 *
 * - Boîte sans curseur (premier chargement, boîte qui vient d'être ouverte à l'utilisateur) : le curseur prend le plus
 *   grand rang présent, sans notification. Ce qui est déjà là est de l'historique.
 * - Ensuite, chaque message notifiable de rang supérieur au curseur, dans une boîte que l'utilisateur lit, est signalé
 *   une seule fois : le curseur avance au plus grand rang vu, notifiable ou non. Le marquage « notifiable » dit déjà
 *   « non lu à l'arrivée » : l'état lu d'aujourd'hui n'est pas relu (l'affichage d'un message le marque lu en quelques
 *   secondes, avant le passage suivant du poste : l'arrivée aurait été perdue).
 * - Un message qui n'est dans aucune boîte de l'utilisateur (mail classé d'un confrère, qui descend par le flux des
 *   messages publics) ne notifie jamais.
 */

export type LigneArrivee = {
  titulaire_id?: string | null;
  arrivee_seq?: number | null;
  arrivee_notifiable?: number | boolean | null;
};

export type CurseursArrivee = Partial<Record<IdBoite, number>>;

export type NotificationArrivee = { boite: IdBoite; nombre: number };

export type DecisionArrivee = {
  /** Curseurs après traitement, à mémoriser avant d'émettre. */
  curseurs: CurseursArrivee;
  /** Au plus une notification par boîte. */
  notifications: NotificationArrivee[];
};

const BOITES: readonly IdBoite[] = ["perso", "partagee"];

function rang(ligne: LigneArrivee): number | null {
  const valeur = ligne.arrivee_seq;
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

function notifiable(ligne: LigneArrivee): boolean {
  const valeur = ligne.arrivee_notifiable;
  return valeur === true || (typeof valeur === "number" && valeur !== 0);
}

/** Boîtes où la base locale porte au moins un message. */
export type PresenceBoites = Record<IdBoite, boolean>;

/**
 * Boîtes que l'utilisateur lit : la sienne dès qu'un compte nominatif ou un de ses messages est synchronisé ; la
 * boîte partagée (ou celle du cabinet, pour les mails à classer) dès qu'un compte partagé ou un message sans
 * titulaire l'est. Une boîte qui n'est pas lue n'a ni curseur ni notification.
 */
export function boitesLues(comptes: readonly Pick<CompteLocal, "type_compte">[], presence: PresenceBoites): IdBoite[] {
  const lues: IdBoite[] = [];
  if (presence.perso || comptes.some((compte) => compte.type_compte === "nominatif")) lues.push("perso");
  if (presence.partagee || comptes.some((compte) => compte.type_compte === "partage")) lues.push("partagee");
  return lues;
}

/**
 * Rang au-dessus duquel il faut lire les messages : le plus petit curseur des boîtes lues, ou 0 tant qu'une de ces
 * boîtes n'a pas de curseur (il faut alors tout voir pour le poser).
 */
export function plancherArrivee(lues: readonly IdBoite[], curseurs: CurseursArrivee): number {
  if (lues.length === 0) return 0;
  let plancher = Number.POSITIVE_INFINITY;
  for (const boite of lues) {
    const curseur = curseurs[boite];
    if (curseur === undefined) return 0;
    plancher = Math.min(plancher, curseur);
  }
  return plancher;
}

export function decisionArrivee(
  lignes: readonly LigneArrivee[],
  lues: readonly IdBoite[],
  monId: string | null,
  curseurs: CurseursArrivee,
): DecisionArrivee {
  const nouveaux: CurseursArrivee = { ...curseurs };
  const notifications: NotificationArrivee[] = [];
  for (const boite of BOITES) {
    if (!lues.includes(boite)) continue;
    const deLaBoite = lignes.filter((ligne) => boiteDuMessage({ titulaire_id: ligne.titulaire_id ?? null }, monId) === boite);
    const rangs = deLaBoite.flatMap((ligne) => {
      const r = rang(ligne);
      return r === null ? [] : [r];
    });
    const plusGrand = rangs.length === 0 ? 0 : Math.max(...rangs);
    const curseur = curseurs[boite];
    if (curseur === undefined) {
      nouveaux[boite] = plusGrand;
      continue;
    }
    const nombre = deLaBoite.filter((ligne) => {
      const r = rang(ligne);
      return r !== null && r > curseur && notifiable(ligne);
    }).length;
    if (nombre > 0) notifications.push({ boite, nombre });
    nouveaux[boite] = Math.max(curseur, plusGrand);
  }
  return { curseurs: nouveaux, notifications };
}

/**
 * Texte de la notification : le nom de la boîte et le nombre de mails, jamais l'objet, l'expéditeur ni le corps
 * (confidentialité : le centre de notifications du système n'est pas un lieu sûr).
 */
export function contenuNotificationArrivee(notification: NotificationArrivee): { titre: string; corps: string } {
  return {
    titre: fr(notification.nombre === 1 ? "Nouveau mail" : `${String(notification.nombre)} nouveaux mails`),
    corps: fr(notification.boite === "perso" ? "Ma boîte" : "Boîte partagée"),
  };
}
