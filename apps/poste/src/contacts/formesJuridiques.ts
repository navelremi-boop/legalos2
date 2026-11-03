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

/** Sigle usuel des formes courantes, pour le nom affiché (« SAS Ferrand Métal ») ; vide sinon. */
export function sigleForme(valeur: string | null | undefined): string {
  const code = valeur?.trim() ?? "";
  if (!/^\d{4}$/u.test(code)) return "";
  if (code === "5710") return "SAS";
  if (code === "5785") return "SELAS";
  if (code === "5485") return "SELARL";
  if (code === "5385") return "SELCA";
  if (code === "5585" || code === "5685") return "SELAFA";
  if (code.startsWith("54")) return "SARL";
  if (code.startsWith("55") || code.startsWith("56")) return "SA";
  if (code === "5202") return "SNC";
  if (code === "5306") return "SCS";
  if (code === "5308") return "SCA";
  if (code === "6540") return "SCI";
  if (code === "6589") return "SCM";
  if (code >= "6561" && code <= "6585") return "SCP";
  return "";
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
