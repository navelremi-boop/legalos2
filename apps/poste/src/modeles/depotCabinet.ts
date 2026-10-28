import { invoke } from "@tauri-apps/api/core";
import { apiUrl } from "@/lib/auth/client";
import { assurerJetonAcces } from "@/lib/session/rafraichir";
import { loadInstanceUrl } from "@/lib/session/storage";
import type { GenreModele } from "@/modeles/fusionDocx";

type DepotLien = { url: string; methode?: string; entetes?: Record<string, string> };
type Lecture = { url: string; empreinte: string };

export class DepotDiffere extends Error {
  constructor() {
    super("réseau indisponible");
    this.name = "DepotDiffere";
  }
}

async function session(): Promise<{ jeton: string; base: string }> {
  const jeton = await assurerJetonAcces();
  const base = loadInstanceUrl();
  if (!jeton || !base) throw new DepotDiffere();
  return { jeton, base };
}

async function lireReponse(reponse: Response): Promise<unknown> {
  const texte = await reponse.text();
  if (texte === "") return null;
  return JSON.parse(texte) as unknown;
}

function exigerLien(valeur: unknown): string {
  if (valeur !== null && typeof valeur === "object" && "url" in valeur) {
    const url = (valeur as { url?: unknown }).url;
    if (typeof url === "string" && url !== "") return url;
  }
  throw new Error("lien de dépôt absent");
}

export async function empreinteSha256(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(digest)].map((octet) => octet.toString(16).padStart(2, "0")).join("");
}

async function deposer(url: string, octets: Uint8Array, entetes: Record<string, string> = {}): Promise<void> {
  try {
    await invoke("deposer_octets_url", {
      url,
      octets: Array.from(octets),
      entetes,
    });
  } catch (erreur) {
    if (erreur instanceof Error && /dépôt HTTP [45]/.test(erreur.message) && !/dépôt HTTP 5/.test(erreur.message)) {
      throw erreur;
    }
    throw new DepotDiffere();
  }
}

/** Envoie le modèle au cabinet. Échoue sans écrire si le réseau ou l'instance ne répond pas. */
export async function envoyerModele(genre: GenreModele, octets: Uint8Array): Promise<void> {
  const { jeton, base } = await session();
  const empreinte = await empreinteSha256(octets);
  let preparation: Response;
  try {
    preparation = await fetch(apiUrl(base, `/modeles-documents/${genre}`), {
      method: "PUT",
      headers: { authorization: `Bearer ${jeton}`, accept: "application/json" },
    });
  } catch {
    throw new DepotDiffere();
  }
  if (!preparation.ok) {
    if (preparation.status >= 500) throw new DepotDiffere();
    throw new Error("préparation du modèle refusée");
  }
  const lien = exigerLien(await lireReponse(preparation));
  await deposer(lien, octets);
  let sceau: Response;
  try {
    sceau = await fetch(apiUrl(base, `/modeles-documents/${genre}/sceller`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${jeton}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        empreinte,
        idempotence_cle: `modele:${genre}:${empreinte}`,
      }),
    });
  } catch {
    throw new DepotDiffere();
  }
  if (!sceau.ok) {
    if (sceau.status >= 500) throw new DepotDiffere();
    throw new Error("scellement du modèle refusé");
  }
}

/** Copie distante, ou null si le cabinet n'a pas remplacé le modèle livré. */
export async function lireModeleDistant(genre: GenreModele): Promise<Uint8Array | null> {
  const { jeton, base } = await session();
  let lecture: Response;
  try {
    lecture = await fetch(apiUrl(base, `/modeles-documents/${genre}`), {
      headers: { authorization: `Bearer ${jeton}`, accept: "application/json" },
    });
  } catch {
    throw new DepotDiffere();
  }
  if (lecture.status === 404) return null;
  if (!lecture.ok) {
    if (lecture.status >= 500) throw new DepotDiffere();
    throw new Error("lecture du modèle refusée");
  }
  const corps = (await lireReponse(lecture)) as Lecture;
  const url = exigerLien(corps);
  try {
    const chemin = await invoke<string>("telecharger_vers_cache", {
      documentId: `modele-${genre}`,
      nomFichier: `${genre}.docx`,
      url,
    });
    const octets = await invoke<number[]>("lire_octets_cache", { chemin });
    return Uint8Array.from(octets);
  } catch {
    throw new DepotDiffere();
  }
}

/**
 * Crée le document versionné (version 1 scellée). Une coupure réseau lève `DepotDiffere`
 * sans rien confirmer : l'appelant garde le fichier en cache et réessaie.
 */
export async function verserDocument(
  documentId: string,
  dossierId: string,
  nom: string,
  octets: Uint8Array,
  empreinte: string,
): Promise<void> {
  const { jeton, base } = await session();
  const entetes = {
    authorization: `Bearer ${jeton}`,
    accept: "application/json",
    "content-type": "application/json",
  };
  let preparation: Response;
  try {
    preparation = await fetch(apiUrl(base, "/documents"), {
      method: "POST",
      headers: entetes,
      body: JSON.stringify({
        id: documentId,
        dossier_id: dossierId,
        nom,
        idempotence_cle: `fusion:${documentId}`,
      }),
    });
  } catch {
    throw new DepotDiffere();
  }
  if (preparation.ok) {
    const depot = (await lireReponse(preparation)) as DepotLien;
    const url = exigerLien(depot);
    const entetesDepot: Record<string, string> = {};
    for (const [cle, valeur] of Object.entries(depot.entetes ?? {})) {
      if (typeof valeur === "string") entetesDepot[cle] = valeur;
    }
    await deposer(url, octets, entetesDepot);
  } else if (preparation.status >= 500) {
    throw new DepotDiffere();
  } else if (preparation.status !== 409) {
    throw new Error("création du document refusée");
  }
  let sceau: Response;
  try {
    sceau = await fetch(apiUrl(base, `/documents/${documentId}/versions/1/sceller`), {
      method: "POST",
      headers: entetes,
      body: JSON.stringify({
        empreinte,
        idempotence_cle: `fusion:${documentId}:sceau`,
      }),
    });
  } catch {
    throw new DepotDiffere();
  }
  if (!sceau.ok) {
    if (sceau.status >= 500) throw new DepotDiffere();
    throw new Error("scellement du document refusé");
  }
}
