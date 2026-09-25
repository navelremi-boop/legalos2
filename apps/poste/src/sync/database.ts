import { PowerSyncTauriDatabase } from "@powersync/tauri-plugin";
import { invoke } from "@tauri-apps/api/core";
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
  await invoke("assurer_repertoire_poste");
  const posteId = await invoke<string>("poste_isolation_id");
  const suffix = posteId === "" ? "" : `-${posteId}`;
  const database = new PowerSyncTauriDatabase({
    schema: AppSchema,
    database: {
      dbFilename: `legalos-powersync${suffix}.db`,
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
