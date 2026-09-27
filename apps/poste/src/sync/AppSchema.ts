import { column, Schema, Table } from "@powersync/common";

/**
 * Schéma client PowerSync minimal (miroir stub — phase contrats J0.6).
 * Aligné avec docs/sync-streams.md ; parité Postgres à valider par test instance.
 */

const cabinets = new Table({
  slug: column.text,
  nom: column.text,
  totp_obligatoire: column.integer,
  cree_le: column.text,
  revision: column.integer,
  /** Modèle de référence du cabinet (R0) ; lecture hors ligne. */
  reference_modele: column.text,
  /** Politique `annuelle` | `jamais` ; pas de séquence ni d'initiales en local. */
  reference_remise_a_zero: column.text,
});

const journalModifications = new Table(
  {
    cabinet_id: column.text,
    /** Nul pour les enregistrements du cabinet ; sinon id du dossier. */
    dossier_id: column.text,
    table_cible: column.text,
    enregistrement_id: column.text,
    champ: column.text,
    valeur_remplacee: column.text,
    valeur_appliquee: column.text,
    revision_base: column.integer,
    revision_appliquee: column.integer,
    conflit: column.integer,
    poste_id: column.text,
    cree_le: column.text,
  },
  { indexes: { enregistrement: ["enregistrement_id"], dossier: ["dossier_id"] } },
);

/** Refus serveur (400/403/404/409) — local, hors synchronisation (docs/conflits.md § 5). */
const refusSync = new Table(
  {
    table_cible: column.text,
    enregistrement_id: column.text,
    operation: column.text,
    statut: column.integer,
    message: column.text,
    cree_le: column.text,
  },
  { localOnly: true },
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
    /** Attribuée par le serveur (§ 3.4) ; null hors ligne jusqu’à sync. */
    reference: column.text,
    /** Avocat responsable (UUID) ; initiales de la référence figées à l’attribution. */
    responsable_id: column.text,
    nom: column.text,
    chemise: column.text,
    juridiction: column.text,
    numero_rg: column.text,
    restreint: column.integer,
    /** Aligné sur `restreint` (CHECK serveur) ; source de vérité partagée. */
    visibilite: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { cabinet: ["cabinet_id"], rg: ["numero_rg"], reference: ["reference"] } },
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

const tempsSaisis = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    intervenant_id: column.text,
    minutes: column.integer,
    libelle: column.text,
    taux_centimes_heure: column.integer,
    ht_centimes: column.integer,
    visibilite: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"] } },
);

const brouillonsFacture = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    temps_id: column.text,
    numero: column.integer,
    ht_centimes: column.integer,
    libelle: column.text,
    intervenant_id: column.text,
    taux_centimes_heure: column.integer,
    visibilite: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"] } },
);

const tauxHoraires = new Table(
  {
    cabinet_id: column.text,
    client_partie_id: column.text,
    dossier_id: column.text,
    intervenant_id: column.text,
    centimes_par_heure: column.integer,
    visibilite: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { cabinet: ["cabinet_id"], dossier: ["dossier_id"] } },
);

export const AppSchema = new Schema({
  cabinets,
  journal_modifications: journalModifications,
  refus_sync: refusSync,
  users,
  postes,
  dossiers,
  parties,
  documents,
  document_versions: documentVersions,
  temps_saisis: tempsSaisis,
  brouillons_facture: brouillonsFacture,
  taux_horaires: tauxHoraires,
});

export type Database = (typeof AppSchema)["types"];
export type CabinetRecord = Database["cabinets"];
export type UserRecord = Database["users"];
export type PosteRecord = Database["postes"];
export type DossierRecord = Database["dossiers"];
export type PartieRecord = Database["parties"];
export type TempsSaisiRecord = Database["temps_saisis"];
export type BrouillonFactureRecord = Database["brouillons_facture"];
export type TauxHoraireRecord = Database["taux_horaires"];
