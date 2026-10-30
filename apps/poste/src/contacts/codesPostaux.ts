import base from "./codesPostaux.json" with { type: "json" };

const CODES: Readonly<Record<string, readonly string[]>> = base;

/** Communes du premier code postal à cinq chiffres trouvé dans la saisie. */
export function communesDuCode(saisie: string): readonly string[] {
  const trouve = /\b(\d{5})\b/.exec(saisie);
  if (trouve === null) return [];
  const code = trouve[1];
  if (code === undefined) return [];
  return CODES[code] ?? [];
}

/** France, ou pays non saisi : la base des codes postaux s'applique. */
export function estAdresseFrance(pays: string): boolean {
  const texte = pays.trim().toLocaleLowerCase("fr");
  return texte === "" || texte === "france" || texte === "fr";
}

/** Ajoute la commune choisie, sans la répéter. */
export function avecCommune(valeur: string, commune: string): string {
  if (valeur.toLocaleUpperCase("fr").includes(commune.toLocaleUpperCase("fr"))) return valeur;
  const trimmed = valeur.trim();
  return trimmed === "" ? commune : `${trimmed} ${commune}`;
}

export function nombreDeCodesPostaux(): number {
  return Object.keys(CODES).length;
}
