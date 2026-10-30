export type PropositionSiren = {
  siren: string;
  denomination: string | null;
  forme: string | null;
  adresseSiege: string | null;
  activite: string | null;
};

export type ChampImport = "denomination" | "forme" | "adresseSiege" | "activite";

export type LigneProposition = {
  champ: ChampImport;
  libelle: string;
  ancien: string;
  registre: string;
};

type FicheComparee = {
  nom: string;
  forme: string | null;
  adresseSiege: string | null;
  activite: string | null;
};

function texte(valeur: string | null | undefined): string {
  const net = valeur?.trim() ?? "";
  return net === "" ? "—" : net;
}

/** Ancienne valeur et valeur du registre, côte à côte. Rien n'est appliqué ici. */
export function lignesProposition(fiche: FicheComparee, proposition: PropositionSiren): LigneProposition[] {
  return [
    {
      champ: "denomination",
      libelle: "Dénomination",
      ancien: texte(fiche.nom),
      registre: texte(proposition.denomination),
    },
    {
      champ: "forme",
      libelle: "Forme",
      ancien: texte(fiche.forme),
      registre: texte(proposition.forme),
    },
    {
      champ: "adresseSiege",
      libelle: "Adresse du siège",
      ancien: texte(fiche.adresseSiege),
      registre: texte(proposition.adresseSiege),
    },
    {
      champ: "activite",
      libelle: "Activité",
      ancien: texte(fiche.activite),
      registre: texte(proposition.activite),
    },
  ];
}

export function champsRetenus(
  proposition: PropositionSiren,
  coches: Readonly<Record<ChampImport, boolean>>,
): Partial<Record<ChampImport, string>> {
  const retenus: Partial<Record<ChampImport, string>> = {};
  const paires: [ChampImport, string | null][] = [
    ["denomination", proposition.denomination],
    ["forme", proposition.forme],
    ["adresseSiege", proposition.adresseSiege],
    ["activite", proposition.activite],
  ];
  for (const [champ, valeur] of paires) {
    const net = valeur?.trim() ?? "";
    if (coches[champ] && net !== "") retenus[champ] = net;
  }
  return retenus;
}
