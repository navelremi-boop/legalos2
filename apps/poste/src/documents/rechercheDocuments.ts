import { echapperMotifLike } from "@/lib/echapperMotifLike";
import { getPowerSyncDatabase } from "@/sync/database";

export type ResultatRechercheDocument = {
  document_id: string;
  nom: string;
  repertoire_id: string | null;
};

let fts5Connu: boolean | null = null;

/**
 * PowerSync embarque une SQLite sans FTS5 (constaté via pragma_compile_options).
 * En l'absence de FTS5, recherche `LIKE` avec `%` / `_` échappés.
 */
export async function fts5Disponible(): Promise<boolean> {
  if (fts5Connu !== null) return fts5Connu;
  try {
    const database = await getPowerSyncDatabase();
    const rows = await database.getAll<{ compile_options: string }>(
      `SELECT compile_options FROM pragma_compile_options
       WHERE compile_options LIKE 'ENABLE_FTS%'`,
    );
    fts5Connu = rows.length > 0;
  } catch {
    fts5Connu = false;
  }
  return fts5Connu;
}

export async function rechercherDocuments(
  dossierId: string,
  termeBrut: string,
): Promise<ResultatRechercheDocument[]> {
  const terme = termeBrut.trim();
  if (terme === "") return [];
  const database = await getPowerSyncDatabase();
  const motif = `%${echapperMotifLike(terme)}%`;
  // FTS5 absent du SQLite PowerSync : LIKE sur nom + texte de version.
  await fts5Disponible();
  return database.getAll<ResultatRechercheDocument>(
    `SELECT DISTINCT d.id AS document_id, d.nom, d.repertoire_id
     FROM documents d
     LEFT JOIN document_versions v ON v.document_id = d.id
     WHERE d.dossier_id = ?
       AND (
         d.nom LIKE ? ESCAPE '\\'
         OR IFNULL(v.texte, '') LIKE ? ESCAPE '\\'
       )
     ORDER BY d.nom COLLATE NOCASE`,
    [dossierId, motif, motif],
  );
}
