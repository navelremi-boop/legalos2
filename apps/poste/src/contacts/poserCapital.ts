import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit le capital en centimes et la monnaie. Un montant vide retire le capital. */
export async function poserCapital(
  contactId: string,
  centimes: number | null,
  monnaie: string | null,
): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute("UPDATE contacts SET capital_centimes = ?, monnaie = ? WHERE id = ?", [
      centimes,
      monnaie,
      contactId,
    ]);
  });
}
