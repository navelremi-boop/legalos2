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
  /** UUID d’un utilisateur du cabinet ; défaut = créateur (session). */
  responsableId: string;
  typeDossier?: "contentieux" | "conseil" | "autre";
  etape?: "ouverture" | "instruction" | "plaidoirie" | "jugement" | "execution" | "clos";
};

export async function ecrireDossier(saisie: NouveauDossier): Promise<string> {
  if (!isChemiseId(saisie.chemise)) {
    throw new Error("Couleur de chemise inconnue");
  }
  const responsableId = saisie.responsableId.trim();
  if (responsableId === "") {
    throw new Error("Responsable du dossier requis");
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
  const typeDossier = saisie.typeDossier ?? "autre";
  const etape = saisie.etape ?? "ouverture";
  await database.writeTransaction(async (tx) => {
    // `reference` reste NULL : attribution uniquement côté serveur (§ 3.4).
    await tx.execute(
      `INSERT INTO dossiers (
        id, cabinet_id, reference, responsable_id, nom, chemise, juridiction, numero_rg,
        type_dossier, etape, restreint, visibilite, revision, cree_le
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        dossierId,
        cabinetId,
        responsableId,
        saisie.nom.trim(),
        saisie.chemise,
        saisie.juridiction.trim(),
        saisie.numeroRg.trim(),
        typeDossier,
        etape,
        saisie.restreint ? 1 : 0,
        saisie.restreint ? "restreint" : "public",
        creeLe,
      ],
    );
    await tx.execute(
      `INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, contact_id, revision, cree_le)
       VALUES (?, ?, ?, ?, ?, NULL, 1, ?)`,
      [partieId, dossierId, cabinetId, saisie.partieRole, saisie.partieNom.trim(), creeLe],
    );
  });
  return dossierId;
}
