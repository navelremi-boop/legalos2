/** Identifiants des huit chemises (§ 7.3 / 7.4). */
export const CHEMISE_IDS = [
  "kraft",
  "bleu-classeur",
  "vert-amande",
  "jaune-paille",
  "rose-buvard",
  "lilas",
  "vert-eau",
  "gris-perle",
] as const;

export type ChemiseId = (typeof CHEMISE_IDS)[number];

export function isChemiseId(value: string): value is ChemiseId {
  return (CHEMISE_IDS as readonly string[]).includes(value);
}
