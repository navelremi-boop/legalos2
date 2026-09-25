import { PowerSyncDatabase } from "@powersync/web";

import { AppSchema } from "@/sync/AppSchema";

let db: PowerSyncDatabase | null = null;

export function getPowerSyncDatabase(): PowerSyncDatabase {
  if (db === null) {
    const recetteHooks = import.meta.env.VITE_LEGALOS_RECETTE_HOOKS === "1";
    db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: "legalos-powersync.db" },
      ...(recetteHooks
        ? {
            flags: {
              useWebWorker: false,
              enableMultiTabs: false,
            },
          }
        : {}),
    });
  }
  return db;
}

export async function closePowerSyncDatabase(): Promise<void> {
  if (db !== null) {
    await db.close();
    db = null;
  }
}
