import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from "@powersync/web";

import { normalizeInstanceUrl } from "@/lib/auth/client";

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
      // Écritures serveur validées par l’API — file d’upload J3+ (docs/sync-rules.md).
      await transaction.complete();
    },
  };
}
