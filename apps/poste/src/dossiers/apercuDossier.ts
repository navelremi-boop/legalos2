export type EtatEtape = "fait" | "cours" | "futur";

export type EtapeProcedure = {
  code: string;
  libelle: string;
  etat: EtatEtape;
};

const CONTENTIEUX = [
  ["ouverture", "Ouverture"],
  ["instruction", "Instruction"],
  ["plaidoirie", "Plaidoirie"],
  ["jugement", "Jugement"],
  ["execution", "Exécution"],
  ["clos", "Clos"],
] as const;

const CONSEIL = [
  ["ouverture", "Ouverture"],
  ["instruction", "Instruction"],
  ["clos", "Clos"],
] as const;

/** Étapes du dossier, l'étape courante au milieu, les précédentes faites. */
export function etapesProcedure(typeDossier: string | null, etape: string | null): EtapeProcedure[] {
  const liste = typeDossier === "contentieux" ? CONTENTIEUX : CONSEIL;
  const index = liste.findIndex(([code]) => code === etape);
  return liste.map(([code, libelle], rang) => ({
    code,
    libelle,
    etat: index < 0 ? "futur" : rang < index ? "fait" : rang === index ? "cours" : "futur",
  }));
}

export type ElementRecent = {
  id: string;
  genre: "mail" | "piece" | "facture";
  titre: string;
  quand: string;
};

export function derniersElements(
  elements: readonly ElementRecent[],
  limite = 3,
): ElementRecent[] {
  return [...elements].sort((a, b) => b.quand.localeCompare(a.quand) || a.id.localeCompare(b.id)).slice(0, limite);
}

export function resumeFacturation(
  lignes: readonly { minutes: number; htCentimes: number; facture: boolean }[],
): { nonFactureMinutes: number; factureCentimes: number } {
  let nonFactureMinutes = 0;
  let factureCentimes = 0;
  for (const ligne of lignes) {
    if (ligne.facture) factureCentimes += ligne.htCentimes;
    else nonFactureMinutes += ligne.minutes;
  }
  return { nonFactureMinutes, factureCentimes };
}
