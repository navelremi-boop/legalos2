/**
 * Empreinte (FNV-1a 32 bits) d'une valeur sérialisable : deux lectures identiques de l'annuaire donnent la même
 * empreinte, ce qui évite de reconstruire l'index et la liste quand rien n'a changé.
 */
export function empreinte(valeur: object): string {
  const texte = JSON.stringify(valeur);
  let hash = 0x811c9dc5;
  for (let i = 0; i < texte.length; i += 1) {
    hash ^= texte.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${String(texte.length)}:${hash.toString(16)}`;
}
