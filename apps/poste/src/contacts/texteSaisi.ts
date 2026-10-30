/** Texte saisi, ou null si le champ est vide. */
export function texteSaisi(saisie: string): string | null {
  const net = saisie.trim();
  return net === "" ? null : net;
}
