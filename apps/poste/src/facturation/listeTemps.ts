import { decalerJour } from "@/agenda/navigationAgenda";
import type { ChemiseId } from "@/lib/chemise";

export type FiltreSaisie = "toutes" | "non-facturees" | "facturees";
export type PerimetreSaisie = "cabinet" | "moi";

export type SaisieTemps = {
  id: string;
  jour: string;
  minutes: number;
  libelle: string;
  dossierId: string;
  dossierNom: string;
  reference?: string | null;
  chemise?: ChemiseId;
  intervenantId: string;
  intervenantNom?: string;
  tauxCentimesHeure: number;
  htCentimes: number;
  facturee: boolean;
};

export type GroupeJour = {
  jour: string;
  minutes: number;
  saisies: SaisieTemps[];
};

export function filtrerSaisies(
  lignes: readonly SaisieTemps[],
  filtre: FiltreSaisie,
  perimetre: PerimetreSaisie,
  moiId: string | null,
): SaisieTemps[] {
  return lignes.filter((ligne) => {
    if (perimetre === "moi" && ligne.intervenantId !== moiId) return false;
    if (filtre === "non-facturees") return !ligne.facturee;
    if (filtre === "facturees") return ligne.facturee;
    return true;
  });
}

export function grouperParJour(lignes: readonly SaisieTemps[]): GroupeJour[] {
  const ordre: string[] = [];
  const parJour = new Map<string, SaisieTemps[]>();
  const triees = [...lignes].sort((a, b) => b.jour.localeCompare(a.jour) || a.id.localeCompare(b.id));
  for (const ligne of triees) {
    const groupe = parJour.get(ligne.jour);
    if (groupe) groupe.push(ligne);
    else {
      ordre.push(ligne.jour);
      parJour.set(ligne.jour, [ligne]);
    }
  }
  return ordre.map((jour) => {
    const saisies = parJour.get(jour) ?? [];
    return {
      jour,
      minutes: saisies.reduce((total, ligne) => total + ligne.minutes, 0),
      saisies,
    };
  });
}

export type VoletTemps = {
  nonFactureMinutes: number;
  nonFactureCentimes: number;
  jours: { jour: string; minutes: number }[];
  dossiers: {
    id: string;
    nom: string;
    reference: string | null;
    chemise?: ChemiseId;
    minutes: number;
    centimes: number;
  }[];
};

/** Colonne de droite : non facturé, sept jours, total par dossier. */
export function voletTemps(lignes: readonly SaisieTemps[], aujourdhui: string): VoletTemps {
  const jours = Array.from({ length: 7 }, (_, index) => ({
    jour: decalerJour(aujourdhui, index - 6),
    minutes: 0,
  }));
  let nonFactureMinutes = 0;
  let nonFactureCentimes = 0;
  const parDossier = new Map<
    string,
    { id: string; nom: string; reference: string | null; chemise?: ChemiseId; minutes: number; centimes: number }
  >();
  for (const ligne of lignes) {
    const cellule = jours.find((jour) => jour.jour === ligne.jour);
    if (cellule) cellule.minutes += ligne.minutes;
    if (ligne.facturee) continue;
    nonFactureMinutes += ligne.minutes;
    nonFactureCentimes += ligne.htCentimes;
    const deja = parDossier.get(ligne.dossierId) ?? {
      id: ligne.dossierId,
      nom: ligne.dossierNom === "" ? "Sans dossier" : ligne.dossierNom,
      reference: ligne.reference ?? null,
      chemise: ligne.chemise,
      minutes: 0,
      centimes: 0,
    };
    deja.minutes += ligne.minutes;
    deja.centimes += ligne.htCentimes;
    parDossier.set(ligne.dossierId, deja);
  }
  const dossiers = [...parDossier.values()].sort(
    (a, b) => b.minutes - a.minutes || a.nom.localeCompare(b.nom, "fr"),
  );
  return { nonFactureMinutes, nonFactureCentimes, jours, dossiers };
}

export function resumeTemps(
  lignes: readonly SaisieTemps[],
  aujourdhui: string,
): { nonFactureMinutes: number; septJoursMinutes: number } {
  const debut = decalerJour(aujourdhui, -6);
  let nonFactureMinutes = 0;
  let septJoursMinutes = 0;
  for (const ligne of lignes) {
    if (!ligne.facturee) nonFactureMinutes += ligne.minutes;
    if (ligne.jour >= debut && ligne.jour <= aujourdhui) septJoursMinutes += ligne.minutes;
  }
  return { nonFactureMinutes, septJoursMinutes };
}
