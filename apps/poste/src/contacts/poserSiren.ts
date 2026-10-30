import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit le SIREN. Null le retire. */
export async function poserSiren(contactId: string, siren: string | null): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute("UPDATE contacts SET siren = ? WHERE id = ?", [siren, contactId]);
  });
}
