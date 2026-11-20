import type { LigneUtilisateur } from "@/identite/libelleMembre";
import type { ProfilMembre } from "@/identite/profilMembre";
import { getPowerSyncDatabase } from "@/sync/database";

/** Membres du cabinet, lus dans la table locale `utilisateurs` (flux `utilisateurs_cabinet`, hors ligne comprise). */
export async function lireMembres(): Promise<LigneUtilisateur[]> {
  const database = await getPowerSyncDatabase();
  return database.getAll<LigneUtilisateur>(
    "SELECT id, email, civilite, prenom, nom, qualite, actif FROM utilisateurs",
  );
}

/**
 * Identité d'un membre vue de la base locale (hors ligne) : sans rôle, que le flux ne porte pas. Sert à afficher
 * « Mon profil » hors ligne, saisie désactivée ; `null` tant que le flux n'a pas apporté la ligne.
 */
export async function lireProfilLocal(id: string): Promise<ProfilMembre | null> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<{
    id: string;
    email: string | null;
    civilite: string | null;
    prenom: string | null;
    nom: string | null;
    qualite: string | null;
    barreau: string | null;
    toque: string | null;
    actif: number | null;
    revision: number | null;
  }>(
    "SELECT id, email, civilite, prenom, nom, qualite, barreau, toque, actif, revision FROM utilisateurs WHERE id = ? LIMIT 1",
    [id],
  );
  const ligne = lignes[0];
  if (ligne === undefined) return null;
  const net = (valeur: string | null): string | null => (valeur === null || valeur.trim() === "" ? null : valeur.trim());
  return {
    id: ligne.id,
    email: net(ligne.email) ?? "",
    role: "collaborateur",
    actif: ligne.actif !== 0,
    civilite: net(ligne.civilite),
    prenom: net(ligne.prenom),
    nom: net(ligne.nom),
    qualite: net(ligne.qualite),
    barreau: net(ligne.barreau),
    toque: net(ligne.toque),
    revision: ligne.revision ?? 1,
  };
}
