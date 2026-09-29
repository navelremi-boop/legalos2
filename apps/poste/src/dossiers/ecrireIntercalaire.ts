import { getPowerSyncDatabase } from "@/sync/database";

type DossierLocal = {
  cabinet_id: string;
  restreint: number | null;
  visibilite: string | null;
};

async function memoriserRevision(id: string, table: string): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.execute(
    "CREATE TABLE IF NOT EXISTS revision_edition (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
  );
  const rows = await database.getAll<{ revision: number | null }>(
    `SELECT revision FROM ${table} WHERE id = ? LIMIT 1`,
    [id],
  );
  const depuisLigne = rows[0]?.revision ?? 1;
  const deja = await database.getAll<{ revision: number | null }>(
    "SELECT revision FROM revision_edition WHERE id = ? LIMIT 1",
    [id],
  );
  const depuisEdition = deja[0]?.revision ?? 0;
  const revision = Math.max(depuisLigne, depuisEdition);
  await database.execute(
    "INSERT INTO revision_edition (id, revision) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision",
    [id, revision],
  );
}

function visibiliteNormalisee(dossier: DossierLocal): { visibilite: string; restreint: number } {
  const restreint = dossier.restreint === 1 || dossier.visibilite === "restreint" ? 1 : 0;
  return {
    restreint,
    visibilite: restreint === 1 ? "restreint" : "public",
  };
}

/** Crée un intercalaire personnalisé local (PUT → API). */
export async function creerIntercalaire(dossierId: string, nom: string): Promise<string> {
  const libelle = nom.trim();
  if (libelle === "") {
    throw new Error("Nom d'intercalaire requis");
  }
  const database = await getPowerSyncDatabase();
  const dossiers = await database.getAll<DossierLocal>(
    "SELECT cabinet_id, restreint, visibilite FROM dossiers WHERE id = ? LIMIT 1",
    [dossierId],
  );
  const dossier = dossiers[0];
  if (!dossier?.cabinet_id) {
    throw new Error("Dossier introuvable");
  }
  const { visibilite, restreint } = visibiliteNormalisee(dossier);
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO intercalaires_personnalises (
        id, cabinet_id, dossier_id, nom, revision, visibilite, restreint, cree_le
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, dossier.cabinet_id, dossierId, libelle, visibilite, restreint, creeLe],
    );
  });
  return id;
}

/** Retire un intercalaire personnalisé (DELETE → API ; CASCADE sur les rattachements seulement). */
export async function retirerIntercalaire(id: string): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute(`DELETE FROM intercalaires_personnalises WHERE id = ?`, [id]);
  });
}

/** Renomme un intercalaire (PATCH avec révision de base). */
export async function renommerIntercalaire(id: string, nom: string): Promise<void> {
  const libelle = nom.trim();
  if (libelle === "") {
    throw new Error("Nom d'intercalaire requis");
  }
  await memoriserRevision(id, "intercalaires_personnalises");
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute(`UPDATE intercalaires_personnalises SET nom = ? WHERE id = ?`, [
      libelle,
      id,
    ]);
  });
}

/**
 * Rattache un élément métier (classement supplémentaire).
 * Types : mail, piece, facture, audience, note.
 */
export async function rattacherElement(params: {
  intercalaireId: string;
  dossierId: string;
  typeElement: "mail" | "piece" | "facture" | "audience" | "note";
  elementId: string;
}): Promise<string> {
  const database = await getPowerSyncDatabase();
  const parent = await database.getAll<{
    restreint: number | null;
    visibilite: string | null;
  }>(
    "SELECT restreint, visibilite FROM intercalaires_personnalises WHERE id = ? LIMIT 1",
    [params.intercalaireId],
  );
  const ligne = parent[0];
  if (!ligne) {
    throw new Error("Intercalaire introuvable");
  }
  const { visibilite, restreint } = visibiliteNormalisee({
    cabinet_id: "",
    restreint: ligne.restreint,
    visibilite: ligne.visibilite,
  });
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO intercalaire_elements (
        id, intercalaire_id, dossier_id, type_element, element_id,
        revision, visibilite, restreint, cree_le
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        params.intercalaireId,
        params.dossierId,
        params.typeElement,
        params.elementId,
        visibilite,
        restreint,
        creeLe,
      ],
    );
  });
  return id;
}
