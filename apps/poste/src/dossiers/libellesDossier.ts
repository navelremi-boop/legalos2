const TYPES: Record<string, string> = {
  contentieux: "Contentieux",
  conseil: "Conseil",
  autre: "Autre",
};

const ETAPES: Record<string, string> = {
  ouverture: "Ouverture",
  instruction: "Instruction",
  plaidoirie: "Plaidoirie",
  jugement: "Jugement",
  execution: "Exécution",
  clos: "Clos",
};

export function libelleTypeDossier(code: string | null | undefined): string {
  if (!code) return "—";
  return TYPES[code] ?? code;
}

export function libelleEtapeDossier(code: string | null | undefined): string {
  if (!code) return "—";
  return ETAPES[code] ?? code;
}
