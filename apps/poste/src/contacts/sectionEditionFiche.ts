/** Section du panneau latéral d'édition de la fiche contact. */
export type SectionEditionFiche =
  | "identite"
  | "situation"
  | "denomination"
  | "forme"
  | "capital"
  | "siren"
  | "greffe"
  | "activite"
  | "tva"
  | "profession"
  | "coordonnee";

const CHAMP_VERS_SECTION: Readonly<Record<string, SectionEditionFiche>> = {
  civilite: "identite",
  prenoms: "identite",
  nom: "identite",
  accord: "identite",
  nom_naissance: "identite",
  date_naissance: "identite",
  lieu_naissance: "identite",
  nationalite: "identite",
  profession: "identite",
  situation: "situation",
  denomination: "denomination",
  forme: "forme",
  capital: "capital",
  siren: "siren",
  greffe: "greffe",
  activite: "activite",
  tva: "tva",
  barreau: "profession",
  toque: "profession",
  specialite: "profession",
  cour_appel: "profession",
  adresse_domicile: "coordonnee",
  adresse_siege: "coordonnee",
};

/** Relie un champ manquant (désignation) à la section d'édition du panneau. */
export function sectionPourChamp(champ: string): SectionEditionFiche {
  return CHAMP_VERS_SECTION[champ] ?? "identite";
}

export function titreSectionEdition(section: SectionEditionFiche): string {
  switch (section) {
    case "identite":
      return "Modifier l'identité";
    case "situation":
      return "Modifier la situation familiale";
    case "denomination":
      return "Modifier la dénomination";
    case "forme":
      return "Modifier la forme";
    case "capital":
      return "Modifier le capital";
    case "siren":
      return "Modifier le SIREN";
    case "greffe":
      return "Modifier le greffe";
    case "activite":
      return "Modifier l'activité";
    case "tva":
      return "Modifier le n° TVA";
    case "profession":
      return "Modifier la profession";
    case "coordonnee":
      return "Ajouter une coordonnée";
  }
}
