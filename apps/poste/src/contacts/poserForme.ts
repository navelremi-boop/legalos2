import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit le code de catégorie juridique sur la fiche locale. Null retire la valeur. */
export async function poserForme(contactId: string, code: string | null): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute("UPDATE contacts SET forme = ? WHERE id = ?", [code, contactId]);
  });
}
