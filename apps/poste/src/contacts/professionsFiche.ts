import type { ProfessionReglementee } from "@/contacts/listeContacts";

export type ChampProfession = "barreau" | "toque" | "specialite" | "cour_appel";

export type ProfessionSaisie = {
  code: ProfessionReglementee | null;
  barreau: string | null;
  toque: string | null;
  specialite: string | null;
  courAppel: string | null;
};

export const PROFESSIONS_FICHE: readonly {
  code: ProfessionReglementee;
  libelle: string;
  champs: readonly ChampProfession[];
}[] = [
  { code: "avocat", libelle: "Avocat", champs: ["barreau", "toque"] },
  { code: "commissaire_justice", libelle: "Commissaire de justice", champs: [] },
  { code: "notaire", libelle: "Notaire", champs: [] },
  { code: "expert_judiciaire", libelle: "Expert judiciaire", champs: ["specialite", "cour_appel"] },
  { code: "administrateur_judiciaire", libelle: "Administrateur judiciaire", champs: [] },
  { code: "mandataire_judiciaire", libelle: "Mandataire judiciaire", champs: [] },
  { code: "expert_comptable", libelle: "Expert-comptable", champs: [] },
  { code: "commissaire_comptes", libelle: "Commissaire aux comptes", champs: [] },
];

export function estProfessionFiche(valeur: string): valeur is ProfessionReglementee {
  return PROFESSIONS_FICHE.some((profession) => profession.code === valeur);
}

export function champsDeProfession(code: string | null): readonly ChampProfession[] {
  return PROFESSIONS_FICHE.find((profession) => profession.code === code)?.champs ?? [];
}

/** Garde seulement les mentions de la profession choisie. */
export function retenirMentions(profession: ProfessionSaisie): ProfessionSaisie {
  const champs = champsDeProfession(profession.code);
  return {
    code: profession.code,
    barreau: champs.includes("barreau") ? profession.barreau : null,
    toque: champs.includes("toque") ? profession.toque : null,
    specialite: champs.includes("specialite") ? profession.specialite : null,
    courAppel: champs.includes("cour_appel") ? profession.courAppel : null,
  };
}
