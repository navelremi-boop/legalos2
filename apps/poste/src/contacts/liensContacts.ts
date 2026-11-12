import { accordDe, fonctionMandatAccordee } from "@/contacts/designation";
import type { AccordGrammatical } from "@/contacts/listeContacts";
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

const TYPES: Record<string, string> = {
  representant_permanent: "Représentant permanent",
  associe: "Associé",
  salarie: "Salarié",
  conjoint_pacs: "Conjoint ou partenaire de PACS",
  parent: "Parent",
  expert_comptable: "Expert-comptable",
  commissaire_comptes: "Commissaire aux comptes",
};

function premiereMajuscule(texte: string): string {
  return texte === "" ? texte : `${texte.charAt(0).toLocaleUpperCase("fr")}${texte.slice(1)}`;
}

/** Accord de la personne qui exerce le mandat, déduit de sa civilité (« Madame » donne le féminin). */
export function accordMandataire(civilite: string | null): AccordGrammatical | null {
  const nette = (civilite ?? "").trim();
  return accordDe(nette === "Mme" ? "Madame" : nette === "M." ? "Monsieur" : nette, null);
}

/** Titre d'un lien ; la fonction d'un mandat s'accorde au féminin quand `accord` est « feminin ». */
export function titreLien(
  lien: Pick<LienAffiche, "typeLien" | "fonction" | "libelle">,
  accord: AccordGrammatical | null = null,
): string {
  if (lien.typeLien === "mandat_social") {
    const accordee = fonctionMandatAccordee(lien.fonction, accord);
    return accordee === null ? (lien.fonction ?? "Mandat") : premiereMajuscule(accordee);
  }
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
  const titre = titreLien(lien, accordMandataire(lien.sourceCivilite));
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
  /** « de » vu depuis la source du lien, « : » vu depuis sa cible, « titre » quand le titre porte déjà « de » (« Expert-comptable de »). */
  liaison: "de" | ":" | "titre";
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

/** Date d'un lien : l'année seule (« 2019 ») est une date valide quand la pièce ne donne pas le jour. */
function dateLien(iso: string): { texte: string; complete: boolean } {
  const annee = /^(\d{4})$/.exec(iso.trim());
  if (annee !== null) return { texte: annee[1] ?? "", complete: false };
  return { texte: formatDateActe(iso), complete: true };
}

function periodeLien(debut: string | null, fin: string | null): string {
  const d = debut === null ? null : dateLien(debut);
  const f = fin === null ? null : dateLien(fin);
  if (d !== null && f !== null) return `du ${d.texte} au ${f.texte}`;
  if (d !== null) return d.complete ? `depuis le ${d.texte}` : `depuis ${d.texte}`;
  if (f !== null) return f.complete ? `jusqu'au ${f.texte}` : `jusqu'en ${f.texte}`;
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
    const titre = lien.typeLien === "parent" && !depuisSource ? "Enfant" : titreLien(lien, accordMandataire(lien.sourceCivilite));
    // « Expert-comptable de » : la maquette met « de » en gras avec le titre de la profession.
    const professionDe = depuisSource && (lien.typeLien === "expert_comptable" || lien.typeLien === "commissaire_comptes");
    lignes.push({
      id: lien.id,
      groupe: groupeLien(lien, depuisSource),
      titre: professionDe ? `${titre} de` : titre,
      liaison: professionDe
        ? "titre"
        : depuisSource || lien.typeLien === "parent" || lien.typeLien === "conjoint_pacs"
          ? "de"
          : ":",
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
