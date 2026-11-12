import type { MentionManquante } from "@/contacts/designation";

/**
 * Article de chaque mention manquante pour la phrase du bandeau de la fiche, d'après la maquette
 * (« la profession », « le capital et l'organe représentant »). Affichage seulement : le libellé
 * de la mention, qui nomme le champ à l'arrêt d'une fusion, reste celui du module de désignation.
 */
const ARTICLES: Readonly<Record<string, string>> = {
  civilite: "la civilité",
  prenoms: "les prénoms",
  nom: "le nom",
  accord: "l'accord grammatical",
  date_naissance: "la date de naissance",
  lieu_naissance: "le lieu de naissance",
  nationalite: "la nationalité",
  profession: "la profession",
  adresse_domicile: "l'adresse du domicile principal",
  fonction: "la fonction du mandat",
  denomination: "la dénomination",
  forme: "la forme",
  capital: "le capital",
  greffe: "le greffe du RCS",
  siren: "le numéro du RCS",
  adresse_siege: "l'adresse du siège",
  representant: "l'organe représentant",
  barreau: "le barreau",
  specialite: "la spécialité",
  cour_appel: "la cour d'appel",
};

export function mentionAvecArticle(mention: MentionManquante): string {
  return ARTICLES[mention.champ] ?? mention.libelle;
}

/** « la profession », « le capital et l'organe représentant », « la civilité, les prénoms et le nom ». */
export function phraseMentions(mentions: readonly MentionManquante[]): string {
  const textes = mentions.map(mentionAvecArticle);
  const dernier = textes.at(-1);
  if (dernier === undefined) return "";
  if (textes.length === 1) return dernier;
  return `${textes.slice(0, -1).join(", ")} et ${dernier}`;
}
