import { getPowerSyncDatabase } from "@/sync/database";

export type GenreCoordonnee = "adresse" | "telephone" | "email" | "site";

export type UsageCoordonnee =
  | "domicile"
  | "siege"
  | "correspondance"
  | "facturation"
  | "cabinet"
  | "etude"
  | "autre";

const GENRES: readonly GenreCoordonnee[] = ["adresse", "telephone", "email", "site"];
const USAGES: readonly UsageCoordonnee[] = [
  "domicile",
  "siege",
  "correspondance",
  "facturation",
  "cabinet",
  "etude",
  "autre",
];

export function estGenreCoordonnee(valeur: string): valeur is GenreCoordonnee {
  return (GENRES as readonly string[]).includes(valeur);
}

export function estUsageCoordonnee(valeur: string): valeur is UsageCoordonnee {
  return (USAGES as readonly string[]).includes(valeur);
}

export async function ecrireCoordonnee(saisie: {
  contactId: string;
  genre: GenreCoordonnee;
  usage: UsageCoordonnee;
  valeur: string;
  principale: boolean;
  pays?: string | null;
}): Promise<string> {
  const valeur = saisie.valeur.trim();
  if (valeur === "") throw new Error("Coordonnée requise");
  const pays = saisie.pays?.trim() ?? "";
  const database = await getPowerSyncDatabase();
  const cabinets = await database.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
  const cabinetId = cabinets[0]?.id;
  if (!cabinetId) throw new Error("Aucun cabinet synchronisé");
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO contact_coordonnees (
        id, cabinet_id, contact_id, genre, usage, valeur, principale, pays, revision, cree_le
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        cabinetId,
        saisie.contactId,
        saisie.genre,
        saisie.usage,
        valeur,
        saisie.principale ? 1 : 0,
        pays === "" ? null : pays,
        creeLe,
      ],
    );
  });
  return id;
}
