export type PhaseChrono = "arrete" | "en-cours" | "pause" | "confirmation";

export type EtatChrono = {
  phase: PhaseChrono;
  secondes: number;
  dossierId: string | null;
  libelle: string;
};

/** Un seul libellé par phase : « en pause » et « en cours » ne sont jamais ensemble. */
export function libellePhaseChrono(phase: PhaseChrono): string {
  if (phase === "pause") return "Chronomètre en pause";
  if (phase === "en-cours") return "Chronomètre en cours";
  if (phase === "confirmation") return "Chronomètre, à confirmer";
  return "Chronomètre";
}

export function chronoArrete(): EtatChrono {
  return { phase: "arrete", secondes: 0, dossierId: null, libelle: "" };
}

export function demarrerChrono(dossierId: string): EtatChrono {
  return { phase: "en-cours", secondes: 0, dossierId, libelle: "" };
}

export function ticChrono(etat: EtatChrono): EtatChrono {
  if (etat.phase !== "en-cours") return etat;
  return { ...etat, secondes: etat.secondes + 1 };
}

export function basculerPause(etat: EtatChrono): EtatChrono {
  if (etat.phase === "en-cours") return { ...etat, phase: "pause" };
  if (etat.phase === "pause") return { ...etat, phase: "en-cours" };
  return etat;
}

export function demanderArret(etat: EtatChrono): EtatChrono {
  if (etat.phase !== "en-cours" && etat.phase !== "pause") return etat;
  return { ...etat, phase: "confirmation" };
}

export function reprendreChrono(etat: EtatChrono): EtatChrono {
  if (etat.phase !== "confirmation") return etat;
  return { ...etat, phase: "en-cours" };
}

/** L'arrêt confirmé s'enregistre en minutes, au moins une. */
export function minutesConfirmees(etat: EtatChrono): number {
  return Math.max(1, Math.round(etat.secondes / 60));
}
