import { getPowerSyncDatabase } from "@/sync/database";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";

export type RecetteHooks = {
  readCabinetNom: () => Promise<string | null>;
  patchCabinetNom: (nom: string) => Promise<void>;
};

export function createRecetteHooks(): RecetteHooks {
  const database = getPowerSyncDatabase();
  return {
    async readCabinetNom() {
      const rows = await database.getAll<{ nom: string }>(
        "SELECT nom FROM cabinets WHERE id = ? LIMIT 1",
        [DEMO_CABINET_ID],
      );
      return rows[0]?.nom ?? null;
    },
    async patchCabinetNom(nom: string) {
      await database.execute("UPDATE cabinets SET nom = ? WHERE id = ?", [nom, DEMO_CABINET_ID]);
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
