/** Première lettre de chaque mot en capitale, le reste inchangé. */
export function majusculeInitiale(texte: string): string {
  return texte.replace(/(^|[\s'’-])(\p{L})/gu, (_tout, sep: string, lettre: string) => {
    return `${sep}${lettre.toLocaleUpperCase("fr-FR")}`;
  });
}
