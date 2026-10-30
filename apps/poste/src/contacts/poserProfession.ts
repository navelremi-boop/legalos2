import type { ProfessionSaisie } from "@/contacts/professionsFiche";
import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit la profession réglementée. Un code vide retire aussi les mentions. */
export async function poserProfession(contactId: string, profession: ProfessionSaisie): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE contacts
       SET profession_reglementee = ?, barreau = ?, toque = ?, specialite = ?, cour_appel = ?
       WHERE id = ?`,
      [
        profession.code,
        profession.barreau,
        profession.toque,
        profession.specialite,
        profession.courAppel,
        contactId,
      ],
    );
  });
}
