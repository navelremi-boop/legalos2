/** Liste livrée. Une qualité de partie ne se rattache pas ; les conseils et représentants, si. */
export const QUALITES_LIVREES = [
  { code: "client", libelle: "client", admetRattachement: false },
  { code: "adversaire", libelle: "adversaire", admetRattachement: false },
  { code: "demandeur", libelle: "demandeur", admetRattachement: false },
  { code: "defendeur", libelle: "défendeur", admetRattachement: false },
  { code: "intervenant_volontaire", libelle: "intervenant volontaire", admetRattachement: false },
  { code: "intervenant_force", libelle: "intervenant forcé", admetRattachement: false },
  { code: "appelant", libelle: "appelant", admetRattachement: false },
  { code: "intime", libelle: "intimé", admetRattachement: false },
  { code: "appele_jugement_commun", libelle: "appelé en déclaration de jugement commun", admetRattachement: false },
  { code: "caution", libelle: "caution", admetRattachement: true },
  { code: "assureur", libelle: "assureur", admetRattachement: true },
  { code: "avocat", libelle: "avocat", admetRattachement: true },
  { code: "avocat_plaidant", libelle: "avocat plaidant", admetRattachement: true },
  { code: "avocat_postulant", libelle: "avocat postulant", admetRattachement: true },
  { code: "commissaire_justice", libelle: "commissaire de justice", admetRattachement: true },
  { code: "notaire", libelle: "notaire", admetRattachement: true },
  { code: "expert_amiable", libelle: "expert amiable", admetRattachement: true },
  { code: "expert_judiciaire", libelle: "expert judiciaire", admetRattachement: true },
  { code: "administrateur_judiciaire", libelle: "administrateur judiciaire", admetRattachement: true },
  { code: "mandataire_judiciaire", libelle: "mandataire judiciaire", admetRattachement: true },
  { code: "liquidateur_judiciaire", libelle: "liquidateur judiciaire", admetRattachement: true },
  { code: "commissaire_execution_plan", libelle: "commissaire à l'exécution du plan", admetRattachement: true },
  { code: "curateur", libelle: "curateur", admetRattachement: true },
  { code: "tuteur", libelle: "tuteur", admetRattachement: true },
  { code: "representant_legal", libelle: "représentant légal", admetRattachement: true },
  { code: "associe", libelle: "associé", admetRattachement: false },
  { code: "apporteur_affaires", libelle: "apporteur d'affaires", admetRattachement: true },
  { code: "autre", libelle: "autre", admetRattachement: true },
] as const;

export type IntervenantAffiche = {
  id: string;
  codeQualite: string;
  libelleQualite: string;
  prenoms: string | null;
  nom: string;
  accord: "masculin" | "feminin" | null;
  rattacheA: string | null;
};

export type GroupeIntervenants = {
  qualite: string;
  entrees: {
    id: string;
    texte: string;
    enfants: { id: string; texte: string }[];
  }[];
};

function identite(ligne: IntervenantAffiche): string {
  const nom = [ligne.prenoms, ligne.nom].filter((part) => part !== null && part !== "").join(" ");
  if (ligne.codeQualite === "avocat" || ligne.codeQualite.startsWith("avocat_")) return `Me ${nom}`;
  return nom;
}

function qualiteAccordee(ligne: IntervenantAffiche): string {
  if (ligne.codeQualite === "avocat" && ligne.accord === "feminin") return "avocate";
  if (ligne.codeQualite === "avocat_plaidant" && ligne.accord === "feminin") return "avocate plaidante";
  if (ligne.codeQualite === "avocat_postulant" && ligne.accord === "feminin") return "avocate postulante";
  return ligne.libelleQualite;
}

/** « Me Anne Perrin, avocate de SARL Duclos Industrie ». */
export function libelleRattache(enfant: IntervenantAffiche, parentNom: string): string {
  return `${identite(enfant)}, ${qualiteAccordee(enfant)} de ${parentNom}`;
}

export function grouperIntervenants(lignes: readonly IntervenantAffiche[]): GroupeIntervenants[] {
  const parId = new Map(lignes.map((ligne) => [ligne.id, ligne]));
  const racines = lignes.filter((ligne) => ligne.rattacheA === null);
  const groupes: GroupeIntervenants[] = [];
  for (const racine of racines) {
    const enfants = lignes
      .filter((ligne) => ligne.rattacheA === racine.id)
      .map((ligne) => ({ id: ligne.id, texte: libelleRattache(ligne, racine.nom) }));
    let groupe = groupes.find((entree) => entree.qualite === racine.libelleQualite);
    if (groupe === undefined) {
      groupe = { qualite: racine.libelleQualite, entrees: [] };
      groupes.push(groupe);
    }
    groupe.entrees.push({ id: racine.id, texte: identite(racine), enfants });
  }
  for (const ligne of lignes) {
    if (ligne.rattacheA !== null && !parId.has(ligne.rattacheA)) {
      let groupe = groupes.find((entree) => entree.qualite === ligne.libelleQualite);
      if (groupe === undefined) {
        groupe = { qualite: ligne.libelleQualite, entrees: [] };
        groupes.push(groupe);
      }
      groupe.entrees.push({ id: ligne.id, texte: identite(ligne), enfants: [] });
    }
  }
  return groupes;
}
