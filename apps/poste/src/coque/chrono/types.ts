/** Types d’éléments du chrono (§ 7.4 vue scindée). */
export type ChronoType = "mail" | "piece" | "facture" | "audience" | "note";

/** Périodes de regroupement du chrono. */
export type ChronoPeriode = "aujourdhui" | "cette-semaine" | "plus-tot";

/** Libellés de badges définitifs (§ 7.4) — réservés à ce qui ne peut plus être modifié. */
export type BadgeDefinitifLibelle = "Communiquées" | "Validée" | "Encaissée" | "Envoyé";

export type ChronoFiltre = "tout" | "mails" | "pieces" | "factures";

export type PieceJointeApercu = {
  extension: string;
  nom: string;
};

export type ChiffreFacture = {
  libelle: string;
  valeur: string;
};

export type EncartApercu = {
  variante: "classement" | "definitif" | "agenda" | "note";
  titre: string;
  detail: string;
  /** Bouton « Changer » (classement mail). */
  actionChanger?: boolean;
};

export type ApercuChrono = {
  mono: string;
  qui: string;
  sousTitre: string;
  quand: string;
  titre: string;
  corps?: string[];
  piecesJointes?: PieceJointeApercu[];
  piecesJointesPlus?: string;
  chiffres?: ChiffreFacture[];
  /** Part encaissée 0–1 (facture). */
  progres?: number;
  encart: EncartApercu;
};

export type ChronoItem = {
  id: string;
  type: ChronoType;
  periode: ChronoPeriode;
  titre: string;
  metadonnees: string;
  /** Heure affichée à droite, absente si un badge définitif est présent. */
  heure?: string;
  badge?: BadgeDefinitifLibelle;
  apercu: ApercuChrono;
};
