import { emettreNotificationBureau } from "@/lib/notificationBureau";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import {
  boitesLues,
  contenuNotificationArrivee,
  decisionArrivee,
  plancherArrivee,
  type CurseursArrivee,
  type LigneArrivee,
} from "@/messagerie/arriveeMails";
import { identifiantUtilisateur } from "@/messagerie/boitesMail";
import type { CompteLocal } from "@/messagerie/typesMails";
import { getPowerSyncDatabase } from "@/sync/database";

/**
 * Émet une notification de bureau pour les mails arrivés depuis le dernier passage (décision : `arriveeMails.ts`).
 * Le curseur (plus grand rang d'arrivée traité, par utilisateur et par boîte) est gardé dans la base locale du poste,
 * hors des tables synchronisées. Il est mémorisé AVANT l'émission : un mail n'est jamais signalé deux fois, même si
 * l'émission échoue ou si l'application redémarre.
 */

let enCours: Promise<void> | null = null;

async function passer(): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.execute(
    `CREATE TABLE IF NOT EXISTS arrivees_notifiees (
       utilisateur TEXT NOT NULL, boite TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (utilisateur, boite)
     )`,
  );
  const comptes = await database.getAll<CompteLocal>("SELECT id, adresse, type_compte, titulaire_id FROM comptes_mail");
  const monId = identifiantUtilisateur(comptes) ?? utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
  if (monId === null) return;
  const presence = await database.getAll<{ perso: number | null; partagee: number | null }>(
    `SELECT SUM(CASE WHEN titulaire_id = ? THEN 1 ELSE 0 END) AS perso,
            SUM(CASE WHEN titulaire_id IS NULL OR titulaire_id = '' THEN 1 ELSE 0 END) AS partagee
     FROM messages`,
    [monId],
  );
  const lues = boitesLues(comptes, {
    perso: (presence[0]?.perso ?? 0) > 0,
    partagee: (presence[0]?.partagee ?? 0) > 0,
  });
  if (lues.length === 0) return;

  const enregistres = await database.getAll<{ boite: string; seq: number }>(
    "SELECT boite, seq FROM arrivees_notifiees WHERE utilisateur = ?",
    [monId],
  );
  const curseurs: CurseursArrivee = {};
  for (const ligne of enregistres) {
    if (ligne.boite === "perso" || ligne.boite === "partagee") curseurs[ligne.boite] = ligne.seq;
  }
  const lignes = await database.getAll<LigneArrivee>(
    "SELECT titulaire_id, arrivee_seq, arrivee_notifiable FROM messages WHERE arrivee_seq > ?",
    [plancherArrivee(lues, curseurs)],
  );
  const decision = decisionArrivee(lignes, lues, monId, curseurs);

  for (const boite of lues) {
    const nouveau = decision.curseurs[boite];
    if (nouveau === undefined || nouveau === curseurs[boite]) continue;
    await database.execute(
      `INSERT INTO arrivees_notifiees (utilisateur, boite, seq) VALUES (?, ?, ?)
       ON CONFLICT(utilisateur, boite) DO UPDATE SET seq = excluded.seq`,
      [monId, boite, nouveau],
    );
  }
  for (const notification of decision.notifications) {
    const { titre, corps } = contenuNotificationArrivee(notification);
    await emettreNotificationBureau(titre, corps);
  }
}

/** Un seul passage à la fois : deux passages simultanés liraient le même curseur et signaleraient deux fois. */
export function emettreNotificationsArrivee(): Promise<void> {
  if (enCours !== null) return enCours;
  enCours = passer().finally(() => {
    enCours = null;
  });
  return enCours;
}
