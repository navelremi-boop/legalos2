export const BIBLIOTHEQUE_DELAIS: readonly {
  id: string;
  label: string;
  jours: number;
  mois: number;
  annees: number;
  augmentationDistance: "oui" | "non" | "regime-special";
  source: string;
}[];

export function dimancheDePaques(annee: number): Date;
export function lireDate(iso: string): Date;
export function ecrireDate(date: Date): string;
export function ajouterMois(origine: Date, mois: number): Date;
export function ajouterAnnees(origine: Date, annees: number): Date;
export function joursFeriesMetropole(annee: number): Set<string>;
export function estOuvrable(date: Date): boolean;
export function prorogerAuJourOuvrable(date: Date): Date;

export type SiegeJuridiction = "metropole" | "collectivite-644";
export type LieuPartie = "metropole" | "outre-mer" | "etranger";
export type AugmentationDistance = "oui" | "non" | "regime-special";
export type RolePartie = "expediteur" | "destinataire";

export type TypeDelai = {
  jours?: number;
  mois?: number;
  annees?: number;
  augmentationDistance?: AugmentationDistance;
};

export type SaisieDelai = {
  origine?: string;
  jours?: number;
  mois?: number;
  annees?: number;
  moisDistance?: number;
  siegeJuridiction?: SiegeJuridiction;
  departementSiege?: string;
  lieuPartie?: LieuPartie;
  collectivite?: string;
  departement?: string;
  typeDelai?: TypeDelai;
  dateExpedition?: string;
  dateRemise?: string;
  rolePartie?: RolePartie;
};

export type ResultatDelai = {
  echeance: string;
  moisAugmentation: number;
  sourceAugmentation: string;
};

export function moisAugmentationDistance(saisie: {
  siegeJuridiction?: SiegeJuridiction;
  departementSiege?: string;
  lieuPartie?: LieuPartie;
  departement?: string;
  collectivite?: string;
  augmentationDistance?: AugmentationDistance;
}): { mois: number; source: string };

export function dateOrigineNotification(saisie: {
  origine?: string;
  dateExpedition?: string;
  dateRemise?: string;
  rolePartie?: RolePartie;
}): string;

export function calculerDelaiComplet(saisie: SaisieDelai): ResultatDelai;

export function calculerChaineAppelConclusions(saisie: {
  origine: string;
  siegeJuridiction?: SiegeJuridiction;
  departementSiege?: string;
  lieuPartie?: LieuPartie;
  departement?: string;
  collectivite?: string;
  dateDeclarationAppel?: string;
  dateExpedition?: string;
  dateRemise?: string;
  rolePartie?: RolePartie;
}): {
  appel: ResultatDelai;
  conclusions: ResultatDelai;
  moisConclusions: number;
  dateDeclarationAppel: string;
};

export function calculerEcheance(saisie: SaisieDelai & { origine: string }): string;
