import { apiUrl } from "@/lib/auth/client";
import { assurerJetonAcces } from "@/lib/session/rafraichir";
import {
  corpsModificationProfil,
  messageErreurProfil,
  profilDepuisJson,
  profilsDepuisJson,
  validerProfil,
  type ProfilMembre,
  type ProfilSaisie,
} from "@/identite/profilMembre";

/**
 * Identité des membres : appels HTTP en ligne avec le jeton, jamais la file d'envoi (décision de l'état-major :
 * l'identité sert d'auteur aux notes, une écriture refusée doit répondre tout de suite).
 */

export type ResultatProfil = { ok: true; profil: ProfilMembre } | { ok: false; message: string };
export type ResultatListeProfils = { ok: true; profils: ProfilMembre[] } | { ok: false; message: string };

type Reponse = { statut: number; json: unknown };

async function appeler(instanceUrl: string, methode: "GET" | "PATCH", chemin: string, corps?: unknown): Promise<Reponse> {
  const jeton = await assurerJetonAcces();
  if (jeton === null) return { statut: 401, json: null };
  try {
    const reponse = await fetch(apiUrl(instanceUrl, chemin), {
      method: methode,
      headers:
        corps === undefined
          ? { authorization: `Bearer ${jeton}` }
          : { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(12_000),
    });
    const json: unknown = await reponse.json().catch(() => null);
    return { statut: reponse.status, json };
  } catch {
    return { statut: 0, json: null };
  }
}

function resultatProfil(reponse: Reponse): ResultatProfil {
  if (reponse.statut < 200 || reponse.statut >= 300) {
    return { ok: false, message: messageErreurProfil(reponse.statut, reponse.json) };
  }
  const profil = profilDepuisJson(reponse.json);
  return profil === null
    ? { ok: false, message: "La réponse du serveur est illisible." }
    : { ok: true, profil };
}

export async function lireMonProfil(instanceUrl: string): Promise<ResultatProfil> {
  return resultatProfil(await appeler(instanceUrl, "GET", "/moi/profil"));
}

export async function listerUtilisateurs(instanceUrl: string): Promise<ResultatListeProfils> {
  const reponse = await appeler(instanceUrl, "GET", "/utilisateurs");
  if (reponse.statut < 200 || reponse.statut >= 300) {
    return { ok: false, message: messageErreurProfil(reponse.statut, reponse.json) };
  }
  return { ok: true, profils: profilsDepuisJson(reponse.json) };
}

/**
 * Enregistre l'identité. `pourMoi` : `PATCH /moi/profil` ; sinon `PATCH /utilisateurs/{id}/profil`
 * (administrateur). Contrôles du poste d'abord ; rien ne part quand rien ne change.
 */
export async function enregistrerProfil(
  instanceUrl: string,
  profil: ProfilMembre,
  saisie: ProfilSaisie,
  pourMoi: boolean,
): Promise<ResultatProfil> {
  const erreurs = Object.values(validerProfil(saisie));
  const premiere = erreurs[0];
  if (premiere !== undefined) return { ok: false, message: premiere };
  const corps = corpsModificationProfil(profil, saisie, crypto.randomUUID());
  if (corps === null) return { ok: true, profil };
  const chemin = pourMoi ? "/moi/profil" : `/utilisateurs/${profil.id}/profil`;
  return resultatProfil(await appeler(instanceUrl, "PATCH", chemin, corps));
}
