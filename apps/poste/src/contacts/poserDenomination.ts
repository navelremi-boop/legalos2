import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit la dénomination. Le nom n'est jamais vide. */
export async function poserDenomination(contactId: string, nom: string): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute("UPDATE contacts SET nom = ? WHERE id = ?", [nom, contactId]);
  });
}
