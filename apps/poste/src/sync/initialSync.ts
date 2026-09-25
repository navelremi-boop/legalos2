import { invoke } from "@tauri-apps/api/core";

import { loadSessionTokens } from "@/lib/session/storage";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { getPowerSyncDatabase } from "@/sync/database";

export type InitialSyncProgress = {
  phase: "connexion" | "schema" | "donnees" | "termine";
  detail: string;
};

const SYNC_POLL_MS = 500;
const SYNC_TIMEOUT_MS = 90_000;

export async function runInitialSync(
  instanceUrl: string,
  onProgress: (progress: InitialSyncProgress) => void,
): Promise<void> {
  onProgress({
    phase: "connexion",
    detail: "Connexion au service de synchronisation…",
  });

  const accessToken = loadSessionTokens().accessToken;
  if (accessToken === null || accessToken === "") {
    throw new Error("Jeton d’accès absent pour PowerSync");
  }

  const database = await getPowerSyncDatabase();
  await invoke("connect_powersync", {
    handle: database.rustHandle,
    instanceUrl,
    accessToken,
  });

  onProgress({
    phase: "schema",
    detail: "Application du schéma local PowerSync…",
  });

  onProgress({
    phase: "donnees",
    detail: "Téléchargement des données autorisées…",
  });

  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await database.getAll<{ id: string }>(
      "SELECT id FROM cabinets WHERE id = ? LIMIT 1",
      [DEMO_CABINET_ID],
    );
    if (rows.length > 0) {
      onProgress({
        phase: "termine",
        detail: "Synchronisation initiale terminée.",
      });
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, SYNC_POLL_MS);
    });
  }

  throw new Error("Délai dépassé : aucune donnée cabinet reçue depuis PowerSync");
}
