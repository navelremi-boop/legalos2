import { PowerSyncTauriDatabase } from "@powersync/tauri-plugin";
import { appDataDir } from "@tauri-apps/api/path";

import { AppSchema } from "@/sync/AppSchema";

let opening: Promise<PowerSyncTauriDatabase> | null = null;

export function getPowerSyncDatabase(): Promise<PowerSyncTauriDatabase> {
  if (opening === null) {
    opening = openDatabase();
  }
  return opening;
}

async function openDatabase(): Promise<PowerSyncTauriDatabase> {
  const database = new PowerSyncTauriDatabase({
    schema: AppSchema,
    database: {
      dbFilename: "legalos-powersync.db",
      dbLocationAsync: appDataDir,
    },
  });
  await database.init();
  return database;
}

export async function closePowerSyncDatabase(): Promise<void> {
  if (opening !== null) {
    const database = await opening;
    await database.disconnect();
    await database.close();
    opening = null;
  }
}
