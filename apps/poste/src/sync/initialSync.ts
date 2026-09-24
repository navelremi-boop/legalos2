/**
 * Synchronisation initiale PowerSync — stub S2 (connexion réelle à brancher en J3).
 */
export type InitialSyncProgress = {
  phase: "connexion" | "schema" | "donnees" | "termine";
  detail: string;
};

export async function runInitialSync(
  onProgress: (progress: InitialSyncProgress) => void,
): Promise<void> {
  onProgress({
    phase: "connexion",
    detail: "Préparation du canal de synchronisation…",
  });
  await delay(400);

  onProgress({
    phase: "schema",
    detail: "Application du schéma local…",
  });
  await delay(400);

  onProgress({
    phase: "donnees",
    detail: "Premier téléchargement des données autorisées…",
  });
  await delay(500);

  onProgress({
    phase: "termine",
    detail: "Synchronisation initiale terminée.",
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
