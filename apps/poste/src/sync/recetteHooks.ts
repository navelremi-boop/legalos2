import { lireNotificationsEmises, type NotificationEmise } from "@/agenda/rappels";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { getPowerSyncDatabase } from "@/sync/database";
import {
  CHAMP_SEUL_PAR_TABLE,
  CHAMPS_PAR_TABLE,
  type TableModifiable,
  estTableModifiable,
} from "@/sync/uploadContrat";

async function memoriserRevision(table: TableModifiable, id: string): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.execute(
    "CREATE TABLE IF NOT EXISTS revision_edition (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
  );
  const rows = await database.getAll<{ revision: number | null }>(
    `SELECT revision FROM ${table} WHERE id = ? LIMIT 1`,
    [id],
  );
  const depuisLigne = rows[0]?.revision ?? 1;
  const deja = await database.getAll<{ revision: number | null }>(
    "SELECT revision FROM revision_edition WHERE id = ? LIMIT 1",
    [id],
  );
  const depuisEdition = deja[0]?.revision ?? 0;
  // Ne jamais redescendre : une édition forcée (recette) ou une réponse d'upload prime.
  const revision = Math.max(depuisLigne, depuisEdition);
  await database.execute(
    "INSERT INTO revision_edition (id, revision) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision",
    [id, revision],
  );
}

async function patcherChamp(
  table: TableModifiable,
  id: string,
  champ: string,
  valeur: string | number,
): Promise<void> {
  const autorises = CHAMPS_PAR_TABLE[table];
  if (!autorises.includes(champ)) {
    throw new Error(`champ hors périmètre: ${table}.${champ}`);
  }
  await memoriserRevision(table, id);
  const database = await getPowerSyncDatabase();
  // table et champ validés contre le contrat (pas d'interpolation libre).
  // Le SDK journalise le PATCH dans ps_crud (même chemin qu'en production).
  await database.writeTransaction(async (tx) => {
    await tx.execute(`UPDATE ${table} SET ${champ} = ? WHERE id = ?`, [valeur, id]);
  });
}

export type RecetteHooks = {
  readCabinetNom: () => Promise<string | null>;
  readCabinetSlug: () => Promise<string | null>;
  patchCabinetNom: (nom: string) => Promise<void>;
  patchCabinetSlug: (slug: string) => Promise<void>;
  readConflits: () => Promise<number>;
  readRefus: () => Promise<{ message: string; statut: number | null } | null>;
  patchChamp: (
    table: TableModifiable,
    id: string,
    champ: string,
    valeur: string | number,
  ) => Promise<void>;
  patchChampSeul: (
    table: TableModifiable,
    id: string,
    valeur: string | number,
  ) => Promise<void>;
  compterJournalConflits: (tableCible?: string) => Promise<number>;
  compterJournalDossier: (dossierId: string) => Promise<number>;
  injecterCrud: (payload: {
    op: "PUT" | "PATCH" | "DELETE";
    table: string;
    id: string;
    data?: Record<string, unknown>;
  }) => Promise<void>;
  lireSqlite: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  lireNotifications: () => NotificationEmise[];
  decalerOrigineSansRecalcul: (id: string, origine: string) => Promise<void>;
  /** Coupe le flux PowerSync sans fermer la base (écritures locales → ps_crud). */
  disconnectSync: () => Promise<void>;
};

export function createRecetteHooks(): RecetteHooks {
  return {
    async readCabinetNom() {
      const database = await getPowerSyncDatabase();
      const rows = await database.getAll<{ nom: string }>(
        "SELECT nom FROM cabinets WHERE id = ? LIMIT 1",
        [DEMO_CABINET_ID],
      );
      return rows[0]?.nom ?? null;
    },
    async readCabinetSlug() {
      const database = await getPowerSyncDatabase();
      const rows = await database.getAll<{ slug: string }>(
        "SELECT slug FROM cabinets WHERE id = ? LIMIT 1",
        [DEMO_CABINET_ID],
      );
      return rows[0]?.slug ?? null;
    },
    async patchCabinetNom(nom: string) {
      await patcherChamp("cabinets", DEMO_CABINET_ID, "nom", nom);
    },
    async patchCabinetSlug(slug: string) {
      await patcherChamp("cabinets", DEMO_CABINET_ID, "slug", slug);
    },
    async readConflits() {
      const database = await getPowerSyncDatabase();
      const rows = await database.getAll<{ n: number }>(
        "SELECT COUNT(*) AS n FROM journal_modifications WHERE conflit = 1",
      );
      return rows[0]?.n ?? 0;
    },
    async readRefus() {
      const database = await getPowerSyncDatabase();
      const rows = await database.getAll<{ message: string; statut: number | null }>(
        "SELECT message, statut FROM refus_sync ORDER BY cree_le DESC LIMIT 1",
      );
      return rows[0] ?? null;
    },
    async patchChamp(table, id, champ, valeur) {
      if (!estTableModifiable(table)) {
        throw new Error(`table hors périmètre: ${String(table)}`);
      }
      await patcherChamp(table, id, champ, valeur);
    },
    async patchChampSeul(table, id, valeur) {
      const champ = CHAMP_SEUL_PAR_TABLE[table];
      await patcherChamp(table, id, champ, valeur);
    },
    async compterJournalConflits(tableCible) {
      const database = await getPowerSyncDatabase();
      if (tableCible) {
        const rows = await database.getAll<{ n: number }>(
          "SELECT COUNT(*) AS n FROM journal_modifications WHERE conflit = 1 AND table_cible = ?",
          [tableCible],
        );
        return rows[0]?.n ?? 0;
      }
      const rows = await database.getAll<{ n: number }>(
        "SELECT COUNT(*) AS n FROM journal_modifications WHERE conflit = 1",
      );
      return rows[0]?.n ?? 0;
    },
    async compterJournalDossier(dossierId) {
      const database = await getPowerSyncDatabase();
      const rows = await database.getAll<{ n: number }>(
        "SELECT COUNT(*) AS n FROM journal_modifications WHERE dossier_id = ?",
        [dossierId],
      );
      return rows[0]?.n ?? 0;
    },
    async injecterCrud({ op, table, id, data }) {
      const database = await getPowerSyncDatabase();
      const payload =
        op === "DELETE"
          ? { op, type: table, id }
          : { op, type: table, id, data: data ?? {} };
      await database.execute("INSERT INTO ps_crud (data) VALUES (?)", [JSON.stringify(payload)]);
    },
    async lireSqlite(sql, params = []) {
      const database = await getPowerSyncDatabase();
      return database.getAll(sql, params);
    },
    lireNotifications() {
      return lireNotificationsEmises();
    },
    async decalerOrigineSansRecalcul(id: string, origine: string) {
      const database = await getPowerSyncDatabase();
      await database.execute("UPDATE agenda_elements SET origine_calcul = ? WHERE id = ?", [
        origine,
        id,
      ]);
    },
    async disconnectSync() {
      const database = await getPowerSyncDatabase();
      await database.disconnect();
    },
  };
}

declare global {
  interface Window {
    __legalosRecette?: RecetteHooks;
  }
}

export function exposeRecetteHooksIfEnabled(): void {
  if (import.meta.env.VITE_LEGALOS_RECETTE_HOOKS === "1") {
    window.__legalosRecette = createRecetteHooks();
  }
}
