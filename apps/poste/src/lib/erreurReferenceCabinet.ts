export type ErreurReferenceCabinet = {
  message: string;
  /** Présent sur 409 `reference_existante` quand un départ plus élevé rendrait le changement acceptable. */
  numero_depart_minimal: number | null;
};

function lireMessage(corps: unknown, repli: string): string {
  if (corps !== null && typeof corps === "object" && "message" in corps) {
    const message = corps.message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return repli;
}

function entierPositif(valeur: unknown): number | null {
  if (typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 1) {
    return valeur;
  }
  if (typeof valeur === "string" && valeur.trim() !== "") {
    const n = Number(valeur);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return null;
}

/** Parseur du corps d’erreur PUT /cabinets/:id/reference (y compris 409). */
export function erreurReferenceDepuisCorps(
  corps: unknown,
  repli: string,
): ErreurReferenceCabinet {
  const objet = corps !== null && typeof corps === "object" ? (corps as Record<string, unknown>) : {};
  return {
    message: lireMessage(corps, repli),
    numero_depart_minimal: entierPositif(objet.numero_depart_minimal),
  };
}
