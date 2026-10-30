import { estSituationFamiliale } from "@/contacts/situationFamiliale";
import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit la situation sur la fiche locale. Null retire la valeur. */
export async function poserSituationFamiliale(contactId: string, code: string | null): Promise<void> {
  if (code !== null && !estSituationFamiliale(code)) throw new Error("Situation familiale inconnue");
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute("UPDATE contacts SET situation_familiale = ? WHERE id = ?", [code, contactId]);
  });
}
