import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit le greffe ou l'activité. Une chaîne vide retire la valeur. */
export async function poserTexteContact(
  contactId: string,
  champ: "greffe_rcs" | "activite",
  valeur: string | null,
): Promise<void> {
  const database = await getPowerSyncDatabase();
  const sql =
    champ === "greffe_rcs"
      ? "UPDATE contacts SET greffe_rcs = ? WHERE id = ?"
      : "UPDATE contacts SET activite = ? WHERE id = ?";
  await database.writeTransaction(async (tx) => {
    await tx.execute(sql, [valeur, contactId]);
  });
}
