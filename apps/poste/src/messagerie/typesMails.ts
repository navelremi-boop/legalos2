import type { LigneBrouillon } from "@/messagerie/etatRedaction";

/** Formes des données de l'écran Mails : lignes de la base locale (PowerSync) et file d'envoi (API). */

export type CompteLocal = {
  id: string;
  adresse: string;
  type_compte: string;
  titulaire_id?: string | null;
  etat_connexion?: string | null;
};

export type DossierLocal = {
  id: string;
  nom: string;
  chemise: string;
  reference?: string | null;
};

export type MailLocal = {
  id: string;
  message_id?: string | null;
  objet: string | null;
  expediteur: string | null;
  destinataires_texte?: string | null;
  pieces_texte?: string | null;
  extrait_texte?: string | null;
  /** Début du texte nettoyé (la liste ne charge pas le corps entier). */
  debut_texte?: string | null;
  etat_classement: string | null;
  dossier_id: string | null;
  suggestion_dossier_id: string | null;
  titulaire_id?: string | null;
  lu?: number | boolean | null;
  dossier_imap?: string | null;
  cree_le?: string | null;
  /** Brouillon de la base locale présenté dans la liste ; la sélection rouvre la rédaction. */
  brouillon?: boolean;
};

export type InvitationLocale = {
  id: string;
  uid_ical: string;
  sequence: number | null;
  effet: string;
  fuseau: string | null;
  debut: string;
  fin: string | null;
  objet: string | null;
  organisateur: string;
};

export type LigneEnvoi = {
  id: string;
  objet: string;
  destinataire: string;
  etat: string;
};

/** Mode galerie et recettes visuelles : aucune requête PowerSync, aucun appel réseau. */
export type DemonstrationMails = {
  comptes: CompteLocal[];
  mails: MailLocal[];
  dossiers: DossierLocal[];
  invitations?: InvitationLocale[];
  file?: LigneEnvoi[];
  /** Corps des messages, par id. */
  corps?: Record<string, string>;
  /** Heure de la dernière relève des boîtes (ISO) : sans elle, aucun témoin n'est affiché. */
  derniereReleve?: string;
  /** Instant de référence pour « aujourd'hui », « hier » (ISO). Par défaut l'horloge réelle. */
  maintenant?: string;
  /** Message sélectionné au départ. */
  selectionInitiale?: string;
  /** Brouillons de la base locale (rédaction reprise, galerie seulement). */
  brouillons?: LigneBrouillon[];
};
