import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import schemaFts from "@/sync/fts-mails.sql?raw";
import { getPowerSyncDatabase } from "@/sync/database";

export type ResultatRechercheMail = {
  id: string;
  objet: string;
};

let baseFts: Promise<Database> | null = null;

type InitSqlite = (options?: {
  locateFile?: (fichier: string) => string;
}) => Promise<{ oo1: { DB: new (filename?: string, flags?: string) => Database } }>;

async function base(): Promise<Database> {
  if (baseFts === null) {
    const init = sqlite3InitModule as InitSqlite;
    baseFts = init({
      locateFile: (fichier) => (fichier.endsWith(".wasm") ? wasmUrl : fichier),
    }).then((sqlite3) => {
      const db = new sqlite3.oo1.DB(":memory:", "c");
      db.exec(schemaFts);
      return db;
    });
  }
  return baseFts;
}

/** Jeton FTS5 entre guillemets. Vide si le terme n'a pas de mot. */
export function requeteFts(terme: string): string | null {
  const jetons = terme.match(/\p{L}[\p{L}\p{N}]*/gu);
  if (jetons === null || jetons.length === 0) return null;
  return jetons.map((jeton) => `"${jeton.replaceAll('"', "")}"`).join(" ");
}

/**
 * Recherche hors ligne des mails déjà synchronisés.
 * L'index FTS5 est un SQLite wasm (le SQLite PowerSync n'embarque pas FTS5).
 * Aucun appel réseau.
 */
export async function rechercherMailsHorsLigne(terme: string): Promise<ResultatRechercheMail[]> {
  const requete = requeteFts(terme);
  if (requete === null) return [];
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<{ id: string; objet: string | null; texte_brut: string | null }>(
    `SELECT id, objet, texte_brut FROM messages`,
  );
  const fts = await base();
  fts.exec("DELETE FROM mails_fts");
  for (const ligne of lignes) {
    const texte = `${ligne.objet ?? ""} ${ligne.texte_brut ?? ""}`.trim();
    if (texte === "") continue;
    fts.exec({
      sql: "INSERT INTO mails_fts(message_id, texte) VALUES (?, ?)",
      bind: [ligne.id, texte],
    });
  }
  const rows = fts.selectObjects("SELECT message_id FROM mails_fts WHERE mails_fts MATCH ?", [requete]);
  const parId = new Map(lignes.map((ligne) => [ligne.id, ligne.objet ?? ""]));
  const hits: ResultatRechercheMail[] = [];
  for (const row of rows) {
    const id = row.message_id;
    if (typeof id !== "string" || id === "") continue;
    hits.push({ id, objet: parId.get(id) ?? "" });
  }
  return hits;
}
