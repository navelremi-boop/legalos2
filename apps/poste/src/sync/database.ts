import { PowerSyncDatabase } from "@powersync/web";

import { AppSchema } from "@/sync/AppSchema";

let db: PowerSyncDatabase | null = null;

export function getPowerSyncDatabase(): PowerSyncDatabase {
  if (db === null) {
    db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: "legalos-powersync.db" },
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
