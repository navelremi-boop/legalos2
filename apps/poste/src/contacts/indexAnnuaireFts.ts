import { expressionFts, SQL_TABLE_FTS, type LigneIndex } from "@/contacts/indexAnnuaire";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

type Db = {
  exec(sql: string): void;
  prepare(sql: string): {
    bind(params: unknown[]): void;
    step(): boolean;
    reset(): void;
    getString(i: number): string;
    finalize(): void;
  };
  close(): void;
};

export class IndexAnnuaire {
  private readonly db: Db;

  private constructor(db: Db) {
    this.db = db;
  }

  static async ouvrir(): Promise<IndexAnnuaire> {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(":memory:", "c") as unknown as Db;
    db.exec(SQL_TABLE_FTS);
    return new IndexAnnuaire(db);
  }

  remplacer(lignes: readonly LigneIndex[]): void {
    this.db.exec("DELETE FROM annuaire_fts");
    const insert = this.db.prepare("INSERT INTO annuaire_fts(contact_id, corps) VALUES (?, ?)");
    try {
      for (const ligne of lignes) {
        insert.bind([ligne.id, ligne.corps]);
        insert.step();
        insert.reset();
      }
    } finally {
      insert.finalize();
    }
  }

  chercher(saisie: string): string[] | null {
    const expression = expressionFts(saisie);
    if (expression === null) return null;
    const requete = this.db.prepare("SELECT contact_id FROM annuaire_fts WHERE annuaire_fts MATCH ?");
    const ids: string[] = [];
    try {
      requete.bind([expression]);
      while (requete.step()) ids.push(requete.getString(0));
    } finally {
      requete.finalize();
    }
    return ids;
  }

  fermer(): void {
    this.db.close();
  }
}
