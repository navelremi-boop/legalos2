/**
 * Référence de dossier (§ 3.4) : attribuée uniquement par le serveur.
 * Tant qu’elle n’est pas descendue en SQLite (dossier créé hors ligne) :
 * libellé « Référence en attente », repris du cahier § 3.4.
 */
export const REFERENCE_EN_ATTENTE = "Référence en attente";

/** Pattern serveur : année + numéro continu (ex. 2026-042). */
export const REFERENCE_SERVEUR_RE = /^\d{4}-\d+$/;

export function estReferenceServeur(reference: string | null | undefined): boolean {
  return REFERENCE_SERVEUR_RE.test(reference?.trim() ?? "");
}

/** Référence seule (onglets, palette, liste) : « 2026-042 » ou « Référence en attente ». */
export function libelleReferenceDossier(reference: string | null | undefined): string {
  const texte = reference?.trim() ?? "";
  return estReferenceServeur(texte) ? texte : REFERENCE_EN_ATTENTE;
}

/** Ligne de l’étiquette : « Dossier 2026-042 » ou « Référence en attente ». */
export function libelleEtiquetteReference(reference: string | null | undefined): string {
  const texte = reference?.trim() ?? "";
  return estReferenceServeur(texte) ? `Dossier ${texte}` : REFERENCE_EN_ATTENTE;
}
