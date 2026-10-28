/**
 * Lit une durée saisie à la main.
 * « 45 » et « 45 min » sont des minutes. « 1 h 30 » est des heures et des minutes.
 * « 0,75 » et « 1,5 h » sont une fraction d'heure.
 * Une durée nulle, négative ou illisible donne null.
 */
export function lireDuree(texte: string): number | null {
  const brut = texte.trim().toLowerCase().replace(/\s+/g, " ");
  if (brut === "") return null;
  const heuresDecimales = /^(\d+)[,.](\d+)\s*h$/.exec(brut);
  if (heuresDecimales?.[1] !== undefined && heuresDecimales[2] !== undefined) {
    return minutesPositives(Number(`${heuresDecimales[1]}.${heuresDecimales[2]}`) * 60);
  }
  const heuresMinutes = /^(\d+)\s*h(?:\s*(\d+)\s*(?:min|m)?)?$/.exec(brut);
  if (heuresMinutes?.[1] !== undefined) {
    const minutes = heuresMinutes[2] === undefined ? 0 : Number(heuresMinutes[2]);
    if (minutes >= 60) return null;
    return minutesPositives(Number(heuresMinutes[1]) * 60 + minutes);
  }
  const seulementMinutes = /^(\d+)\s*(?:min|m)$/.exec(brut);
  if (seulementMinutes?.[1] !== undefined) return minutesPositives(Number(seulementMinutes[1]));
  const fraction = /^(\d+)[,.](\d+)$/.exec(brut);
  if (fraction?.[1] !== undefined && fraction[2] !== undefined) {
    return minutesPositives(Number(`${fraction[1]}.${fraction[2]}`) * 60);
  }
  const entier = /^(\d+)$/.exec(brut);
  if (entier?.[1] !== undefined) return minutesPositives(Number(entier[1]));
  return null;
}

function minutesPositives(valeur: number): number | null {
  if (!Number.isFinite(valeur)) return null;
  const minutes = Math.round(valeur);
  return minutes > 0 ? minutes : null;
}
