export function dimancheDePaques(annee: number): Date;
export function lireDate(iso: string): Date;
export function ecrireDate(date: Date): string;
export function ajouterMois(origine: Date, mois: number): Date;
export function joursFeriesMetropole(annee: number): Set<string>;
export function estOuvrable(date: Date): boolean;
export function prorogerAuJourOuvrable(date: Date): Date;
export function calculerEcheance(saisie: {
  origine: string;
  jours?: number;
  mois?: number;
  moisDistance?: number;
}): string;
