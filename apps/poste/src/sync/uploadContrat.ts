/**
 * Contrat d'envoi des modifications locales (miroir du connecteur Rust).
 * Utilisé par les hooks de recette et contrôlé par tests/recette/upload-contrat-poste.mjs.
 */

export const TABLES_MODIFIABLES = [
  "cabinets",
  "dossiers",
  "parties",
  "temps_saisis",
  "brouillons_facture",
  "taux_horaires",
] as const;

export type TableModifiable = (typeof TABLES_MODIFIABLES)[number];

/** Champs envoyés en PATCH (docs/conflits.md § 1). */
export const CHAMPS_PAR_TABLE: Record<TableModifiable, readonly string[]> = {
  cabinets: ["nom", "slug"],
  dossiers: ["nom", "chemise", "juridiction", "numero_rg"],
  parties: ["role", "nom"],
  temps_saisis: ["minutes", "libelle", "taux_centimes_heure"],
  brouillons_facture: ["libelle", "taux_centimes_heure"],
  taux_horaires: ["centimes_par_heure"],
};

/** Champ unique utilisé pour la preuve « un champ seul par table ». */
export const CHAMP_SEUL_PAR_TABLE: Record<TableModifiable, string> = {
  cabinets: "nom",
  dossiers: "juridiction",
  parties: "role",
  temps_saisis: "libelle",
  brouillons_facture: "libelle",
  taux_horaires: "centimes_par_heure",
};

export type OperationCrud = "PUT" | "PATCH" | "DELETE";

export function estRefusDefinitif(statut: number): boolean {
  return statut === 400 || statut === 403 || statut === 404 || statut === 409;
}

export function cheminPatch(table: TableModifiable, id: string): string {
  switch (table) {
    case "cabinets":
      return `/api/cabinets/${id}`;
    case "dossiers":
      return `/api/dossiers/${id}`;
    case "parties":
      return `/api/parties/${id}`;
    case "temps_saisis":
      return `/api/temps/${id}`;
    case "brouillons_facture":
      return `/api/brouillons-facture/${id}`;
    case "taux_horaires":
      return `/api/taux-horaires/${id}`;
  }
}

export function filtrerChampsModifies(
  table: TableModifiable,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const autorises = new Set(CHAMPS_PAR_TABLE[table]);
  const out: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(data)) {
    if (autorises.has(cle)) out[cle] = valeur;
  }
  return out;
}

export function estTableModifiable(table: string): table is TableModifiable {
  return (TABLES_MODIFIABLES as readonly string[]).includes(table);
}
