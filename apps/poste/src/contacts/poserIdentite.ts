import type { IdentiteSaisie } from "@/contacts/identiteFiche";
import { getPowerSyncDatabase } from "@/sync/database";

/** Écrit l'identité d'une personne. Le nom n'est jamais vide. */
export async function poserIdentite(contactId: string, identite: IdentiteSaisie): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE contacts
       SET nom = ?, civilite = ?, accord = ?, prenoms = ?, nom_naissance = ?,
           date_naissance = ?, lieu_naissance = ?, nationalite = ?, profession = ?
       WHERE id = ?`,
      [
        identite.nom,
        identite.civilite,
        identite.accord,
        identite.prenoms,
        identite.nomNaissance,
        identite.dateNaissance,
        identite.lieuNaissance,
        identite.nationalite,
        identite.profession,
        contactId,
      ],
    );
  });
}
