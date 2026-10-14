import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/**
 * Notification de bureau du poste (plugin Tauri), pour les rappels d'agenda et l'arrivée des mails.
 * Chaque notification émise est gardée en mémoire : les recettes l'observent par `window.__legalosRecette`
 * (`lireNotifications`), faute de pouvoir lire le centre de notifications du système.
 * Jamais de contenu de mail, de document ni de note dans une notification : le texte vient de l'appelant.
 */

export type NotificationEmise = { titre: string; corps: string };

const emises: NotificationEmise[] = [];

export function lireNotificationsEmises(): NotificationEmise[] {
  return emises.slice();
}

/** Émet une notification ; faux quand l'utilisateur n'a pas accordé l'autorisation. */
export async function emettreNotificationBureau(titre: string, corps: string): Promise<boolean> {
  let accorde = await isPermissionGranted();
  if (!accorde) {
    accorde = (await requestPermission()) === "granted";
  }
  if (!accorde) return false;
  sendNotification({ title: titre, body: corps });
  emises.push({ titre, corps });
  return true;
}
