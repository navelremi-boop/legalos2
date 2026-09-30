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
    type_dossier: column.text,
    etape: column.text,
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
    repertoire_id: column.text,
    nom: column.text,
    visibilite: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"], repertoire: ["repertoire_id"] } },
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
    texte: column.text,
    parent_numero: column.integer,
    cree_le: column.text,
  },
  { indexes: { document: ["document_id"] } },
);

/** Arborescence de fichiers par dossier (contrat serveur documents phase 2). */
const repertoires = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    parent_id: column.text,
    nom: column.text,
    visibilite: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"], parent: ["parent_id"] } },
);

const parties = new Table(
  {
    dossier_id: column.text,
    cabinet_id: column.text,
    role: column.text,
    nom: column.text,
    contact_id: column.text,
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

/** Intercalaires personnalisés (§ 7.4) — hors standards Chrono / Procédure / … */
const intercalairesPersonnalises = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    nom: column.text,
    revision: column.integer,
    visibilite: column.text,
    restreint: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"] } },
);

/** Rattachements (classement supplémentaire ; l'élément reste dans le chrono). */
const intercalaireElements = new Table(
  {
    intercalaire_id: column.text,
    dossier_id: column.text,
    type_element: column.text,
    element_id: column.text,
    revision: column.integer,
    visibilite: column.text,
    restreint: column.integer,
    cree_le: column.text,
  },
  { indexes: { intercalaire: ["intercalaire_id"], dossier: ["dossier_id"] } },
);

/** Annuaire du cabinet (un flux, pas un seau par dossier). */
const contacts = new Table(
  {
    cabinet_id: column.text,
    nature: column.text,
    nom: column.text,
    siren: column.text,
    numero_tva: column.text,
    type_client: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { cabinet: ["cabinet_id"] } },
);

/** Lien de dossiers, une ligne par sens. */
const dossierLiens = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    lie_a_id: column.text,
    revision: column.integer,
    visibilite: column.text,
    restreint: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"], lie: ["lie_a_id"] } },
);

/** Audiences, rendez-vous et tâches (§ 4.2 n° 4). Pas les invitations mail (J11). */
const agendaElements = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    type_element: column.text,
    titre: column.text,
    debut: column.text,
    rappel_le: column.text,
    origine_calcul: column.text,
    jours_calcul: column.integer,
    mois_calcul: column.integer,
    annees_calcul: column.integer,
    revision: column.integer,
    visibilite: column.text,
    restreint: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"], debut: ["debut"] } },
);

/** Compte nominatif du titulaire. Pas de secret IMAP. */
const comptesMail = new Table(
  {
    cabinet_id: column.text,
    type_compte: column.text,
    titulaire_id: column.text,
    adresse: column.text,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { titulaire: ["titulaire_id"] } },
);
const messages = new Table(
  {
    cabinet_id: column.text,
    dossier_id: column.text,
    message_id: column.text,
    objet: column.text,
    expediteur: column.text,
    etat_classement: column.text,
    suggestion_dossier_id: column.text,
    visibilite: column.text,
    restreint: column.integer,
    revision: column.integer,
    cree_le: column.text,
  },
  { indexes: { dossier: ["dossier_id"], etat: ["etat_classement"] } },
);

export const AppSchema = new Schema({
  cabinets,
  journal_modifications: journalModifications,
  refus_sync: refusSync,
  users,
  postes,
  dossiers,
  parties,
  repertoires,
  documents,
  document_versions: documentVersions,
  temps_saisis: tempsSaisis,
  brouillons_facture: brouillonsFacture,
  taux_horaires: tauxHoraires,
  intercalaires_personnalises: intercalairesPersonnalises,
  intercalaire_elements: intercalaireElements,
  contacts,
  dossier_liens: dossierLiens,
  agenda_elements: agendaElements,
  messages,
  comptes_mail: comptesMail,
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
export type IntercalairePersonnaliseRecord = Database["intercalaires_personnalises"];
export type IntercalaireElementRecord = Database["intercalaire_elements"];
