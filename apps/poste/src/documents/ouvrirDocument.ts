import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { apiUrl } from "@/lib/auth/client";
import { loadInstanceUrl, loadSessionTokens } from "@/lib/session/storage";
import { estFichierIgnorePourVersion } from "@/documents/filtreTemporaire";
import { getPowerSyncDatabase } from "@/sync/database";

type DepotVersion = {
  document_id: string;
  numero: number;
  methode: string;
  url: string;
  entetes: Record<string, string>;
};

type VersionScellee = {
  document_id: string;
  numero: number;
  empreinte: string;
  taille: number;
  parent_numero: number | null;
  divergence: boolean;
};

type LectureDocument = { url: string };

const ecoutes = new Map<string, UnlistenFn>();
const empreintesLocales = new Map<string, string>();
const debounces = new Map<string, number>();

function jetonEtBase(): { jeton: string; base: string } {
  const jeton = loadSessionTokens().accessToken;
  const base = loadInstanceUrl();
  if (!jeton || !base) {
    throw new Error("Session absente");
  }
  return { jeton, base };
}

async function derniereVersion(documentId: string): Promise<{
  numero: number;
  empreinte: string | null;
  nom: string;
}> {
  const database = await getPowerSyncDatabase();
  const docs = await database.getAll<{ nom: string }>(
    "SELECT nom FROM documents WHERE id = ? LIMIT 1",
    [documentId],
  );
  const nom = docs[0]?.nom ?? "document.bin";
  const rows = await database.getAll<{ numero: number; empreinte: string | null }>(
    `SELECT numero, empreinte FROM document_versions
     WHERE document_id = ? ORDER BY numero DESC LIMIT 1`,
    [documentId],
  );
  const premiere = rows[0];
  if (!premiere) {
    throw new Error("Aucune version locale");
  }
  return { numero: premiere.numero, empreinte: premiere.empreinte, nom };
}

async function empreinteSha256(octets: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function cheminCacheDocument(documentId: string): Promise<string | null> {
  try {
    return await invoke<string | null>("chemin_cache_document", { documentId });
  } catch {
    return null;
  }
}

export async function renvoyerVersionDepuisCache(
  documentId: string,
  baseNumero: number,
): Promise<VersionScellee | null> {
  const chemin = await cheminCacheDocument(documentId);
  if (!chemin) return null;
  const nom = chemin.replace(/^.*[/\\]/, "");
  if (estFichierIgnorePourVersion(nom)) return null;

  const octets = await invoke<number[]>("lire_octets_cache", { chemin });
  const bytes = Uint8Array.from(octets);
  if (bytes.length === 0) return null;
  const hash = await empreinteSha256(bytes);
  const precedente = empreintesLocales.get(documentId);
  if (precedente === hash) return null;

  const { jeton, base } = jetonEtBase();
  const prep = await fetch(apiUrl(base, `/documents/${documentId}/versions`), {
    method: "POST",
    headers: {
      authorization: `Bearer ${jeton}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ base_numero: baseNumero }),
  });
  if (!prep.ok) {
    throw new Error(`préparation version ${String(prep.status)}`);
  }
  const depot = (await prep.json()) as DepotVersion;
  const entetes: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(depot.entetes)) {
    if (typeof valeur === "string") entetes[cle] = valeur;
  }
  await invoke("deposer_octets_url", {
    url: depot.url,
    octets: [...bytes],
    entetes,
  });
  const sceau = await fetch(
    apiUrl(base, `/documents/${documentId}/versions/${String(depot.numero)}/sceller`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jeton}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        empreinte: hash,
        idempotence_cle: `${documentId}:v${String(depot.numero)}:${hash.slice(0, 12)}`,
      }),
    },
  );
  if (!sceau.ok) {
    throw new Error(`scellement ${String(sceau.status)}`);
  }
  const resultat = (await sceau.json()) as VersionScellee;
  empreintesLocales.set(documentId, hash);
  return resultat;
}

function planifierRenvoi(documentId: string, baseNumero: number, chemin: string): void {
  const nom = chemin.replace(/^.*[/\\]/, "");
  if (estFichierIgnorePourVersion(nom)) return;
  const deja = debounces.get(documentId);
  if (deja !== undefined) window.clearTimeout(deja);
  debounces.set(
    documentId,
    window.setTimeout(() => {
      void renvoyerVersionDepuisCache(documentId, baseNumero).catch(() => {
        /* réseau coupé : nouvel essai au prochain événement */
      });
    }, 600),
  );
}

/**
 * Télécharge la dernière version dans le cache local, ouvre avec l'éditeur
 * par défaut du système (`plugin-opener`, jamais un binaire codé en dur),
 * et surveille le fichier (`notify`) pour renvoyer une version.
 */
export async function ouvrirDocument(documentId: string): Promise<string> {
  const { numero, empreinte, nom } = await derniereVersion(documentId);
  const { jeton, base } = jetonEtBase();
  const lecture = await fetch(apiUrl(base, `/documents/${documentId}/versions/${String(numero)}`), {
    headers: { authorization: `Bearer ${jeton}` },
  });
  if (!lecture.ok) {
    throw new Error(`lecture version ${String(lecture.status)}`);
  }
  const { url } = (await lecture.json()) as LectureDocument;
  const chemin = await invoke<string>("telecharger_vers_cache", {
    documentId,
    nomFichier: nom,
    url,
  });
  const octetsCaches = await invoke<number[]>("lire_octets_cache", { chemin });
  const buffer = Uint8Array.from(octetsCaches);
  const hash = empreinte ?? (await empreinteSha256(buffer));
  empreintesLocales.set(documentId, hash);

  const precedent = ecoutes.get(documentId);
  if (precedent) {
    precedent();
    ecoutes.delete(documentId);
  }
  await invoke("surveiller_cache_document", { documentId, chemin });
  const stop = await listen<{ document_id: string; chemin: string }>(
    "document-cache-modifie",
    (event) => {
      if (event.payload.document_id !== documentId) return;
      planifierRenvoi(documentId, numero, event.payload.chemin || chemin);
    },
  );
  ecoutes.set(documentId, stop);

  try {
    await openPath(chemin);
  } catch {
    // Éditeur absent en CI / poste sans association : le cache et notify restent actifs.
  }
  return chemin;
}

export async function documentADivergence(documentId: string): Promise<boolean> {
  const database = await getPowerSyncDatabase();
  const rows = await database.getAll<{ parent_numero: number | null; n: number }>(
    `SELECT parent_numero, COUNT(*) AS n
     FROM document_versions
     WHERE document_id = ? AND parent_numero IS NOT NULL
     GROUP BY parent_numero
     HAVING COUNT(*) > 1`,
    [documentId],
  );
  return rows.length > 0;
}
