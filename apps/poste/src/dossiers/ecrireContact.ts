import { verifierSirenTva } from "@/dossiers/identifiants";
import { getPowerSyncDatabase } from "@/sync/database";

export type NatureContact = "physique" | "morale";
export type TypeClient = "professionnel" | "particulier" | "etranger";
export type RolePartie = "client" | "adversaire" | "confrere";

type DossierSync = {
  cabinet_id: string;
  visibilite: string | null;
  restreint: number | null;
};

async function cabinetCourant(): Promise<string> {
  const database = await getPowerSyncDatabase();
  const cabinets = await database.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
  const cabinetId = cabinets[0]?.id;
  if (!cabinetId) throw new Error("Aucun cabinet synchronisé");
  return cabinetId;
}

async function lireDossier(dossierId: string): Promise<DossierSync> {
  const database = await getPowerSyncDatabase();
  const rows = await database.getAll<DossierSync>(
    "SELECT cabinet_id, visibilite, restreint FROM dossiers WHERE id = ? LIMIT 1",
    [dossierId],
  );
  const row = rows[0];
  if (!row?.cabinet_id) throw new Error("Dossier introuvable");
  return row;
}

function estRestreint(dossier: DossierSync): boolean {
  return dossier.restreint === 1 || dossier.visibilite === "restreint";
}

export async function ecrireContact(saisie: {
  nature: NatureContact;
  nom: string;
  siren?: string;
  numeroTva?: string;
  typeClient: TypeClient;
}): Promise<string> {
  const nom = saisie.nom.trim();
  if (nom === "") throw new Error("Nom de contact requis");
  verifierSirenTva(saisie.siren, saisie.numeroTva);
  const cabinetId = await cabinetCourant();
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO contacts (
        id, cabinet_id, nature, nom, siren, numero_tva, type_client, revision, cree_le
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        cabinetId,
        saisie.nature,
        nom,
        saisie.siren?.trim() || null,
        saisie.numeroTva?.trim() || null,
        saisie.typeClient,
        creeLe,
      ],
    );
  });
  return id;
}

export async function ajouterPartie(
  dossierId: string,
  role: RolePartie,
  nom: string,
  contactId?: string,
): Promise<string> {
  const libelle = nom.trim();
  if (libelle === "") throw new Error("Nom de partie requis");
  const dossier = await lireDossier(dossierId);
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, contact_id, revision, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, dossierId, dossier.cabinet_id, role, libelle, contactId ?? null, creeLe],
    );
  });
  return id;
}

/** Une ligne locale. Le serveur écrit l'autre sens ; l'écran lit les deux colonnes. */
export async function lierDossiers(dossierId: string, lieAId: string): Promise<string> {
  if (dossierId === lieAId) throw new Error("Un dossier ne se lie pas à lui-même");
  const source = await lireDossier(dossierId);
  const cible = await lireDossier(lieAId);
  if (source.cabinet_id !== cible.cabinet_id) throw new Error("Dossier hors cabinet");
  const restreint = estRestreint(source) || estRestreint(cible);
  const id = crypto.randomUUID();
  const creeLe = new Date().toISOString();
  const database = await getPowerSyncDatabase();
  await database.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO dossier_liens (
        id, cabinet_id, dossier_id, lie_a_id, revision, visibilite, restreint, cree_le
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        source.cabinet_id,
        dossierId,
        lieAId,
        restreint ? "restreint" : "public",
        restreint ? 1 : 0,
        creeLe,
      ],
    );
  });
  return id;
}
