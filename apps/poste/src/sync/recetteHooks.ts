import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { getPowerSyncDatabase } from "@/sync/database";

export type RecetteHooks = {
  readCabinetNom: () => Promise<string | null>;
  readCabinetSlug: () => Promise<string | null>;
  patchCabinetNom: (nom: string) => Promise<void>;
  patchCabinetSlug: (slug: string) => Promise<void>;
  readConflits: () => Promise<number>;
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
      const database = await getPowerSyncDatabase();
      await database.execute("UPDATE cabinets SET nom = ? WHERE id = ?", [nom, DEMO_CABINET_ID]);
    },
    async patchCabinetSlug(slug: string) {
      const database = await getPowerSyncDatabase();
      await database.execute("UPDATE cabinets SET slug = ? WHERE id = ?", [slug, DEMO_CABINET_ID]);
    },
    async readConflits() {
      const database = await getPowerSyncDatabase();
      const rows = await database.getAll<{ n: number }>(
        "SELECT COUNT(*) AS n FROM journal_modifications WHERE conflit = 1",
      );
      return rows[0]?.n ?? 0;
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
