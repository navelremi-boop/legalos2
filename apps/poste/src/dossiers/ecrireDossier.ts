import { isChemiseId, type ChemiseId } from "@/lib/chemise";
import { getPowerSyncDatabase } from "@/sync/database";

export type NouveauDossier = {
  nom: string;
  chemise: ChemiseId;
  juridiction: string;
  numeroRg: string;
  partieNom: string;
  partieRole: "client" | "adversaire" | "confrere";
  restreint: boolean;
};

export async function ecrireDossier(saisie: NouveauDossier): Promise<string> {
  if (!isChemiseId(saisie.chemise)) {
    throw new Error("Couleur de chemise inconnue");
  }
  const database = await getPowerSyncDatabase();
  const cabinets = await database.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
  const cabinetId = cabinets[0]?.id;
  if (!cabinetId) {
    throw new Error("Aucun cabinet synchronisé");
  }
  const dossierId = crypto.randomUUID();
  const partieId = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  await database.writeTransaction(async (tx) => {
    // `reference` reste NULL : attribution uniquement côté serveur (§ 3.4).
    await tx.execute(
      `INSERT INTO dossiers (
        id, cabinet_id, reference, nom, chemise, juridiction, numero_rg, restreint, revision, cree_le
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1, ?)`,
      [
        dossierId,
        cabinetId,
        saisie.nom.trim(),
        saisie.chemise,
        saisie.juridiction.trim(),
        saisie.numeroRg.trim(),
        saisie.restreint ? 1 : 0,
        creeLe,
      ],
    );
    await tx.execute(
      `INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, revision, cree_le)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [partieId, dossierId, cabinetId, saisie.partieRole, saisie.partieNom.trim(), creeLe],
    );
  });
  return dossierId;
}
