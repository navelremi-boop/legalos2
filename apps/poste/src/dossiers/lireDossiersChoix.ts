import { getPowerSyncDatabase } from "@/sync/database";
import type { DossierChoix } from "@/dossiers/rechercheDossier";

/** Dossiers de la base locale, par nom. */
export async function lireDossiersChoix(): Promise<DossierChoix[]> {
  const database = await getPowerSyncDatabase();
  return database.getAll<DossierChoix>(
    "SELECT id, nom, reference, chemise FROM dossiers ORDER BY nom COLLATE NOCASE",
  );
}
