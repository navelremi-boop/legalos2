import { formatDateActe } from "@/lib/format";

export type LienAffiche = {
  id: string;
  sourceId: string;
  cibleId: string;
  sourceCivilite: string | null;
  sourcePrenoms: string | null;
  sourceNom: string;
  cibleNom: string;
  typeLien: string;
  fonction: string | null;
  libelle: string | null;
  representeSociete: boolean;
  debut: string | null;
  fin: string | null;
  /** Pièce qui établit le lien (« Kbis du 2 octobre 2026 »). */
  source?: string | null;
};

const FONCTIONS: Record<string, string> = {
  gerant: "Gérant",
  president: "Président",
  directeur_general: "Directeur général",
  directeur_general_delegue: "Directeur général délégué",
  administrateur: "Administrateur",
  membre_directoire: "Membre du directoire",
  membre_conseil_surveillance: "Membre du conseil de surveillance",
  liquidateur_amiable: "Liquidateur amiable",
};

const TYPES: Record<string, string> = {
  representant_permanent: "Représentant permanent",
  associe: "Associé",
  salarie: "Salarié",
  conjoint_pacs: "Conjoint ou partenaire de PACS",
  parent: "Parent",
  expert_comptable: "Expert-comptable",
  commissaire_comptes: "Commissaire aux comptes",
};

export function titreLien(lien: Pick<LienAffiche, "typeLien" | "fonction" | "libelle">): string {
  if (lien.typeLien === "mandat_social") return FONCTIONS[lien.fonction ?? ""] ?? lien.fonction ?? "Mandat";
  if (lien.typeLien === "autre") return lien.libelle?.trim() || "Autre";
  return TYPES[lien.typeLien] ?? lien.typeLien;
}

export function civiliteCourte(civilite: string | null): string {
  if (civilite === "Monsieur") return "M.";
  if (civilite === "Madame") return "Mme";
  if (civilite === "Maître") return "Me";
  return civilite?.trim() ?? "";
}

function nomPersonne(civilite: string | null, prenoms: string | null, nom: string): string {
  const corps = [prenoms, nom].filter((part) => part !== null && part !== "").join(" ");
  const court = civiliteCourte(civilite);
  return court === "" ? corps : `${court} ${corps}`;
}

/** Libellé vu depuis une des deux fiches, et la période si le lien est terminé. */
export function libelleLien(lien: LienAffiche, vuDepuis: string): { texte: string; periode: string | null } {
  const titre = titreLien(lien);
  const texte =
    vuDepuis === lien.cibleId
      ? `${titre} : ${nomPersonne(lien.sourceCivilite, lien.sourcePrenoms, lien.sourceNom)}`
      : `${titre} de ${lien.cibleNom}`;
  const periode =
    lien.fin !== null && lien.debut !== null
      ? `du ${formatDateActe(lien.debut)} au ${formatDateActe(lien.fin)}`
      : null;
  return { texte, periode };
}

/** Ligne de l'onglet Liens, d'après la maquette : « Président de SAS Ferrand Métal », source, période. */
export type LigneLien = {
  id: string;
  groupe: string;
  titre: string;
  /** « de » vu depuis la source du lien, « : » vu depuis sa cible. */
  liaison: "de" | ":";
  autreId: string;
  autreNom: string;
  source: string | null;
  periode: string;
  termine: boolean;
};

const ORDRE_GROUPES = [
  "Mandats sociaux",
  "Dirigeants",
  "Famille",
  "Professionnels de la société",
  "Clients de la société",
  "Autres liens",
] as const;

function groupeLien(lien: LienAffiche, depuisSource: boolean): string {
  if (lien.typeLien === "mandat_social" || lien.typeLien === "representant_permanent") {
    return depuisSource ? "Mandats sociaux" : "Dirigeants";
  }
  if (lien.typeLien === "conjoint_pacs" || lien.typeLien === "parent") return "Famille";
  if (lien.typeLien === "expert_comptable" || lien.typeLien === "commissaire_comptes") {
    return depuisSource ? "Clients de la société" : "Professionnels de la société";
  }
  return "Autres liens";
}

function periodeLien(debut: string | null, fin: string | null): string {
  if (debut !== null && fin !== null) return `du ${formatDateActe(debut)} au ${formatDateActe(fin)}`;
  if (debut !== null) return `depuis le ${formatDateActe(debut)}`;
  if (fin !== null) return `jusqu'au ${formatDateActe(fin)}`;
  return "";
}

/**
 * Liens d'une fiche, groupés et ordonnés comme la maquette. `nomDe` donne le nom affiché d'une fiche
 * (sigle de forme, civilité courte) ; à défaut, les noms portés par le lien.
 */
export function groupesLiens(
  liens: readonly LienAffiche[],
  vuDepuis: string,
  nomDe: (id: string) => string | null = () => null,
): { groupe: string; lignes: LigneLien[] }[] {
  const lignes: LigneLien[] = [];
  for (const lien of liens) {
    const depuisSource = lien.sourceId === vuDepuis;
    if (!depuisSource && lien.cibleId !== vuDepuis) continue;
    const autreId = depuisSource ? lien.cibleId : lien.sourceId;
    const nomLien = depuisSource
      ? lien.cibleNom
      : nomPersonne(lien.sourceCivilite, lien.sourcePrenoms, lien.sourceNom);
    const titre = lien.typeLien === "parent" && !depuisSource ? "Enfant" : titreLien(lien);
    lignes.push({
      id: lien.id,
      groupe: groupeLien(lien, depuisSource),
      titre,
      liaison: depuisSource || lien.typeLien === "parent" || lien.typeLien === "conjoint_pacs" ? "de" : ":",
      autreId,
      autreNom: nomDe(autreId) ?? nomLien,
      source: (lien.source?.trim() ?? "") === "" ? null : (lien.source?.trim() ?? null),
      periode: periodeLien(lien.debut, lien.fin),
      termine: lien.fin !== null,
    });
  }
  return ORDRE_GROUPES.map((groupe) => ({ groupe, lignes: lignes.filter((ligne) => ligne.groupe === groupe) })).filter(
    (entree) => entree.lignes.length > 0,
  );
}
