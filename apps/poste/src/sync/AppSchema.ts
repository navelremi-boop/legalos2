import { column, Schema, Table } from "@powersync/common";

/**
 * Sch├®ma client PowerSync minimal (miroir stub ÔÇö phase contrats J0.6).
 * Align├® avec docs/sync-streams.md ; parit├® Postgres ├á valider par test instance.
 */

const cabinets = new Table({
  slug: column.text,
  nom: column.text,
  totp_obligatoire: column.integer,
  cree_le: column.text,
  revision: column.integer,
});

const journalModifications = new Table(
  {
    cabinet_id: column.text,
    table_cible: column.text,
    enregistrement_id: column.text,
    champ: column.text,
    valeur_remplacee: column.text,
    valeur_appliquee: column.text,
    revision_base: column.integer,
    revision_appliquee: column.integer,
    conflit: column.integer,
    cree_le: column.text,
  },
  { indexes: { enregistrement: ["enregistrement_id"] } },
);

const users = new Table(
  {
    cabinet_id: column.text,
    display_name: column.text,
    email: column.text,
    role: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { cabinet: ["cabinet_id"] } },
);

const postes = new Table(
  {
    cabinet_id: column.text,
    user_id: column.text,
    device_label: column.text,
    registered_at: column.text,
    revoked_at: column.text,
  },
  { indexes: { cabinet: ["cabinet_id"], user: ["user_id"] } },
);

const dossiers = new Table(
  {
    cabinet_id: column.text,
    nom: column.text,
    chemise: column.text,
    juridiction: column.text,
    numero_rg: column.text,
    restreint: column.integer,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { cabinet: ["cabinet_id"], rg: ["numero_rg"] } },
);

const documents = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    nom: column.text,
    visibilite: column.text,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"] } },
);

const documentVersions = new Table(
  {
    document_id: column.text,
    cabinet_id: column.text,
    dossier_id: column.text,
    numero: column.integer,
    empreinte: column.text,
    taille: column.integer,
    auteur_id: column.text,
    visibilite: column.text,
    cree_le: column.text,
  },
  { indexes: { document: ["document_id"] } },
);

const parties = new Table(
  {
    dossier_id: column.text,
    cabinet_id: column.text,
    role: column.text,
    nom: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"] } },
);

export const AppSchema = new Schema({
  cabinets,
  journal_modifications: journalModifications,
  users,
  postes,
  dossiers,
  parties,
  documents,
  document_versions: documentVersions,
});

export type Database = (typeof AppSchema)["types"];
export type CabinetRecord = Database["cabinets"];
export type UserRecord = Database["users"];
export type PosteRecord = Database["postes"];
export type DossierRecord = Database["dossiers"];
export type PartieRecord = Database["parties"];
