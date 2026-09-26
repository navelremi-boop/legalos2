/**
 * Référence de dossier (§ 3.4) : attribuée uniquement par le serveur.
 * Hors ligne / avant sync → libellé français « en attente ».
 */
export const REFERENCE_EN_ATTENTE = "en attente";

/** Pattern serveur : année + numéro continu (ex. 2026-042). */
export const REFERENCE_SERVEUR_RE = /^\d{4}-\d+$/;

export function libelleReferenceDossier(reference: string | null | undefined): string {
  const texte = reference?.trim();
  return texte ? texte : REFERENCE_EN_ATTENTE;
}

export function estReferenceServeur(reference: string | null | undefined): boolean {
  return REFERENCE_SERVEUR_RE.test(reference?.trim() ?? "");
}
