import base from "./formesJuridiques.json" with { type: "json" };

export type FormeJuridique = {
  code: string;
  libelle: string;
  niveau: 1 | 2 | 3;
};

const TABLE: Readonly<Record<string, { libelle: string; niveau: number }>> = base;

function plier(valeur: string): string {
  return valeur
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function niveauDe(valeur: number): 1 | 2 | 3 {
  if (valeur === 1 || valeur === 2) return valeur;
  return 3;
}

const FORMES: readonly FormeJuridique[] = Object.entries(TABLE)
  .map(([code, entree]) => ({
    code,
    libelle: entree.libelle,
    niveau: niveauDe(entree.niveau),
  }))
  .sort((a, b) => a.code.localeCompare(b.code, "fr"));

/** Libellé officiel si la valeur est un code, sinon le texte déjà saisi. */
export function libelleForme(valeur: string): string {
  const net = valeur.trim();
  return TABLE[net]?.libelle ?? net;
}

/** Code et libellé, pour l'affichage côte à côte. Un texte libre reste tel quel. */
export function texteForme(valeur: string | null | undefined): string {
  const net = valeur?.trim() ?? "";
  if (net === "") return "";
  const connu = TABLE[net]?.libelle;
  if (connu === undefined || connu.toLocaleLowerCase("fr") === net.toLocaleLowerCase("fr")) return net;
  return `${net} — ${connu}`;
}

/** Catégories de niveau III correspondant à la recherche. Moins de deux caractères : rien, sauf le code déjà retenu. */
export function formesFiltrees(recherche: string, codeCourant: string | null = null): readonly FormeJuridique[] {
  const q = plier(recherche.trim());
  const niveau3 = FORMES.filter((forme) => forme.niveau === 3);
  const retenues =
    q.length < 2
      ? []
      : niveau3
          .filter((forme) => plier(forme.code).includes(q) || plier(forme.libelle).includes(q))
          .slice(0, 30);
  if (codeCourant === null || codeCourant === "" || retenues.some((forme) => forme.code === codeCourant)) {
    return retenues;
  }
  const courante = FORMES.find((forme) => forme.code === codeCourant);
  return courante === undefined ? retenues : [courante, ...retenues];
}

export function nombreDeFormes(niveau: 1 | 2 | 3 = 3): number {
  return FORMES.filter((forme) => forme.niveau === niveau).length;
}
