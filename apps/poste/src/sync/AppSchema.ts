import { column, Schema, Table } from "@powersync/web";

/**
 * Schéma client PowerSync minimal (miroir stub — phase contrats J0.6).
 * Aligné avec docs/sync-rules.md ; parité Postgres à valider par test instance.
 */

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
    reference: column.text,
    title: column.text,
    chemise: column.text,
    restricted: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { cabinet: ["cabinet_id"] } },
);

export const AppSchema = new Schema({
  users,
  postes,
  dossiers,
});

export type Database = (typeof AppSchema)["types"];
export type UserRecord = Database["users"];
export type PosteRecord = Database["postes"];
export type DossierRecord = Database["dossiers"];
