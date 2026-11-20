import type { CommonPowerSyncDatabase } from "@powersync/common";
import type { ChampsLienModifies, LienNormalise } from "@/contacts/controleLien";

/**
 * Écriture locale des liens entre contacts : une transaction PowerSync, hors ligne comprise. Le connecteur du poste
 * porte ensuite les lignes à l'API (`POST /contacts/{source}/liens`, `PATCH /contact-liens/{id}`), qui refait les
 * contrôles ; un refus revient en message lisible. Les contrôles du poste sont dans `controleLien.ts` et passent
 * avant ces écritures.
 */

export type BaseLiens = Pick<CommonPowerSyncDatabase, "getAll" | "writeTransaction">;

/** Lien à créer : la source est la personne ou la société qui porte le lien, la cible celle à laquelle il mène. */
export type LienAEcrire = LienNormalise & { sourceId: string; cibleId: string };

/** Dirigeant du registre dont on crée la fiche. */
export type FicheDirigeant = {
  nature: "physique" | "morale";
  nom: string;
  prenoms: string | null;
  siren: string | null;
};

/** Valeur de `source_import` d'une fiche née du registre ; l'API en tire sa marque d'import. */
export const SOURCE_REGISTRE = "recherche-entreprises";

async function cabinetCourant(base: BaseLiens): Promise<string> {
  const cabinets = await base.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
  const id = cabinets[0]?.id;
  if (id === undefined || id === "") throw new Error("Aucun cabinet synchronisé");
  return id;
}

const SQL_INSERT_LIEN = `INSERT INTO contact_liens (
    id, cabinet_id, contact_source_id, contact_cible_id, type_lien, fonction, libelle,
    represente_societe, pour_le_compte_de, debut, fin, source, note, revision, cree_le
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?)`;

function valeursLien(id: string, cabinetId: string, lien: LienAEcrire, creeLe: string): unknown[] {
  return [
    id,
    cabinetId,
    lien.sourceId,
    lien.cibleId,
    lien.typeLien,
    lien.fonction,
    lien.libelle,
    lien.representeSociete ? 1 : 0,
    lien.debut,
    lien.fin,
    lien.source,
    lien.note,
    creeLe,
  ];
}

/** Crée un lien. Retourne son identifiant (celui du client : l'API le reprend, un rejeu ne crée rien de plus). */
export async function creerLien(base: BaseLiens, lien: LienAEcrire, maintenant: Date = new Date()): Promise<string> {
  const cabinetId = await cabinetCourant(base);
  const id = crypto.randomUUID();
  const creeLe = maintenant.toISOString();
  await base.writeTransaction(async (tx) => {
    await tx.execute(SQL_INSERT_LIEN, valeursLien(id, cabinetId, lien, creeLe));
  });
  return id;
}

/**
 * Crée la fiche d'un dirigeant proposé par le registre ET son lien vers la société dans la même transaction
 * locale : la file d'envoi garde cet ordre, la fiche part avant le lien qui la désigne.
 */
export async function creerFicheEtLien(
  base: BaseLiens,
  fiche: FicheDirigeant,
  lien: Omit<LienAEcrire, "sourceId">,
  maintenant: Date = new Date(),
): Promise<{ contactId: string; lienId: string }> {
  const nom = fiche.nom.trim();
  if (nom === "") throw new Error("Nom du dirigeant requis");
  const cabinetId = await cabinetCourant(base);
  const contactId = crypto.randomUUID();
  const lienId = crypto.randomUUID();
  const creeLe = maintenant.toISOString();
  const prenoms = fiche.prenoms?.trim() ?? "";
  const siren = fiche.siren?.replace(/\D/g, "") ?? "";
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO contacts (
        id, cabinet_id, nature, nom, prenoms, siren, type_client, source_import, importe_le, revision, cree_le
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        contactId,
        cabinetId,
        fiche.nature,
        nom,
        prenoms === "" ? null : prenoms,
        siren.length === 9 ? siren : null,
        fiche.nature === "morale" ? "professionnel" : "particulier",
        SOURCE_REGISTRE,
        creeLe,
        creeLe,
      ],
    );
    await tx.execute(SQL_INSERT_LIEN, valeursLien(lienId, cabinetId, { ...lien, sourceId: contactId }, creeLe));
  });
  return { contactId, lienId };
}

const COLONNES_MODIFIABLES: readonly (keyof ChampsLienModifies)[] = ["debut", "fin", "source"];

/** Modifie début, fin ou source d'un lien (`null` efface). Sans changement, rien n'est écrit. */
export async function modifierLien(base: BaseLiens, id: string, champs: ChampsLienModifies): Promise<boolean> {
  const colonnes = COLONNES_MODIFIABLES.filter((colonne) => colonne in champs);
  if (colonnes.length === 0) return false;
  const sql = `UPDATE contact_liens SET ${colonnes.map((colonne) => `${colonne} = ?`).join(", ")} WHERE id = ?`;
  const valeurs = [...colonnes.map((colonne) => champs[colonne] ?? null), id];
  await base.writeTransaction(async (tx) => {
    await tx.execute(sql, valeurs);
  });
  return true;
}
