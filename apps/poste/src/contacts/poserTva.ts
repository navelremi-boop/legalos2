import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit le numéro de TVA. Null le retire. */
export async function poserTva(contactId: string, numero: string | null): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute("UPDATE contacts SET numero_tva = ? WHERE id = ?", [numero, contactId]);
  });
}
