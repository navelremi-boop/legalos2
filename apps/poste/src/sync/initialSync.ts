import { createPowerSyncConnector } from "@/sync/connector";
import { getPowerSyncDatabase } from "@/sync/database";
import { loadSessionTokens } from "@/lib/session/storage";

export type InitialSyncProgress = {
  phase: "connexion" | "schema" | "donnees" | "termine";
  detail: string;
};

const DEMO_CABINET_ID = "01950000-0000-7000-8000-000000000001";
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

  const database = getPowerSyncDatabase();
  const connector = createPowerSyncConnector(instanceUrl, () => loadSessionTokens().accessToken);

  await database.connect(connector);

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
