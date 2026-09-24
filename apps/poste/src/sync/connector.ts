import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from "@powersync/web";
import { UpdateType } from "@powersync/web";

import { apiUrl, normalizeInstanceUrl } from "@/lib/auth/client";

export function createPowerSyncConnector(
  instanceUrl: string,
  getAccessToken: () => string | null,
): PowerSyncBackendConnector {
  const syncEndpoint = `${normalizeInstanceUrl(instanceUrl)}/sync`;

  return {
    fetchCredentials() {
      const token = getAccessToken();
      if (token === null || token === "") {
        return Promise.reject(new Error("Jeton d’accès absent pour PowerSync"));
      }
      return Promise.resolve({
        endpoint: syncEndpoint,
        token,
      });
    },

    async uploadData(database: AbstractPowerSyncDatabase) {
      const transaction = await database.getNextCrudTransaction();
      if (transaction === null) {
        return;
      }
      const token = getAccessToken();
      if (token === null || token === "") {
        throw new Error("Jeton d’accès absent pour l’upload sync");
      }
      for (const op of transaction.crud) {
        if (op.table !== "cabinets") {
          continue;
        }
        if (op.op !== UpdateType.PATCH && op.op !== UpdateType.PUT) {
          continue;
        }
        const nom = (op.opData as { nom?: unknown }).nom;
        if (typeof nom !== "string" || nom.trim() === "") {
          continue;
        }
        const response = await fetch(apiUrl(instanceUrl, `/cabinets/${op.id}`), {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ nom: nom.trim() }),
        });
        if (!response.ok) {
          throw new Error(`Upload cabinet rejeté (${String(response.status)})`);
        }
      }
      await transaction.complete();
    },
  };
}
