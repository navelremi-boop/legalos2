import { invoke } from "@tauri-apps/api/core";
import { lireAttente, memoriserAttente, oublierAttente, type DepotEnAttente } from "@/modeles/attenteDepot";
import { DepotDiffere, empreinteSha256, verserDocument } from "@/modeles/depotCabinet";
import {
  balisesResiduelles,
  fusionnerDocx,
  stylesIdentiques,
  type GenreModele,
} from "@/modeles/fusionDocx";
import { lireModele } from "@/modeles/stockModeles";
import { getPowerSyncDatabase } from "@/sync/database";

export type ResultatFusion = {
  documentId: string;
  nom: string;
  stylesIdentiques: boolean;
  balisesResiduelles: number;
  enAttente: boolean;
};

const NOMS: Record<GenreModele, string> = {
  courrier: "Courrier",
  convention: "Convention",
  acte: "Acte",
};

async function donneesDossier(dossierId: string): Promise<{
  cabinetId: string;
  donnees: Record<string, string>;
}> {
  const database = await getPowerSyncDatabase();
  const dossiers = await database.getAll<{
    nom: string;
    reference: string | null;
    cabinet_id: string;
  }>("SELECT nom, reference, cabinet_id FROM dossiers WHERE id = ? LIMIT 1", [dossierId]);
  const dossier = dossiers[0];
  if (!dossier?.cabinet_id) throw new Error("Dossier introuvable");
  const cabinets = await database.getAll<{ nom: string }>("SELECT nom FROM cabinets WHERE id = ? LIMIT 1", [
    dossier.cabinet_id,
  ]);
  const clients = await database.getAll<{ nom: string }>(
    "SELECT nom FROM parties WHERE dossier_id = ? AND role = 'client' ORDER BY cree_le LIMIT 1",
    [dossierId],
  );
  return {
    cabinetId: dossier.cabinet_id,
    donnees: {
      dossier_nom: dossier.nom,
      dossier_reference: dossier.reference ?? "",
      client_nom: clients[0]?.nom ?? "",
      cabinet_nom: cabinets[0]?.nom ?? "",
    },
  };
}

async function verserOuDifferer(
  stock: Storage,
  entree: DepotEnAttente,
  octets: Uint8Array,
): Promise<boolean> {
  try {
    await verserDocument(entree.documentId, entree.dossierId, entree.nom, octets, entree.empreinte);
    oublierAttente(stock, entree.documentId);
    return false;
  } catch (erreur) {
    if (!(erreur instanceof DepotDiffere)) throw erreur;
    memoriserAttente(stock, entree);
    return true;
  }
}

/** Reprend les documents déjà fusionnés dont le versement a été coupé. */
export async function reprendreDepots(stock: Storage = localStorage): Promise<number> {
  let repris = 0;
  for (const entree of lireAttente(stock)) {
    let octets: Uint8Array;
    try {
      const lus = await invoke<number[]>("lire_octets_cache", { chemin: entree.chemin });
      octets = Uint8Array.from(lus);
    } catch {
      continue;
    }
    const differe = await verserOuDifferer(stock, entree, octets);
    if (!differe) repris += 1;
  }
  return repris;
}

/** Produit le document sur le poste. Le versement au dossier versionné attend le réseau, sans rien perdre. */
export async function produireDocument(
  dossierId: string,
  genre: GenreModele,
  stock: Storage = localStorage,
): Promise<ResultatFusion> {
  const { cabinetId, donnees } = await donneesDossier(dossierId);
  const modele = lireModele(stock, cabinetId, genre);
  const octets = fusionnerDocx(modele, donnees);
  const documentId = crypto.randomUUID();
  const nom = `${NOMS[genre]}.docx`;
  const empreinte = await empreinteSha256(octets);
  const chemin = await invoke<string>("ecrire_cache_document", {
    documentId,
    nomFichier: nom,
    octets: Array.from(octets),
  });
  const enAttente = await verserOuDifferer(
    stock,
    { documentId, dossierId, nom, empreinte, chemin },
    octets,
  );
  return {
    documentId,
    nom,
    stylesIdentiques: stylesIdentiques(modele, octets),
    balisesResiduelles: balisesResiduelles(octets),
    enAttente,
  };
}
