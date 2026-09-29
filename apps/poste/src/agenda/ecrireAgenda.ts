import { getPowerSyncDatabase } from "@/sync/database";

export type TypeAgenda = "audience" | "rendez_vous" | "tache";

type DossierSync = {
  cabinet_id: string;
  visibilite: string | null;
  restreint: number | null;
};

export async function ecrireElementAgenda(saisie: {
  dossierId: string;
  typeElement: TypeAgenda;
  titre: string;
  debut: string;
  rappelLe?: string;
}): Promise<string> {
  const titre = saisie.titre.trim();
  const debut = saisie.debut.trim();
  if (titre === "" || debut === "") throw new Error("Titre et début requis");
  const database = await getPowerSyncDatabase();
  const dossiers = await database.getAll<DossierSync>(
    "SELECT cabinet_id, visibilite, restreint FROM dossiers WHERE id = ? LIMIT 1",
    [saisie.dossierId],
  );
  const dossier = dossiers[0];
  if (!dossier?.cabinet_id) throw new Error("Dossier introuvable");
  const restreint = dossier.restreint === 1 || dossier.visibilite === "restreint" ? 1 : 0;
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  const rappel = saisie.rappelLe?.trim() || null;
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO agenda_elements (
        id, cabinet_id, dossier_id, type_element, titre, debut, rappel_le,
        revision, visibilite, restreint, cree_le
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        dossier.cabinet_id,
        saisie.dossierId,
        saisie.typeElement,
        titre,
        debut,
        rappel,
        restreint === 1 ? "restreint" : "public",
        restreint,
        creeLe,
      ],
    );
  });
  return id;
}
