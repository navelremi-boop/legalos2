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

function civiliteCourte(civilite: string | null): string {
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
