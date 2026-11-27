/**
 * Petites règles de rédaction des actes, sans dépendance : civilité abrégée, SIREN par groupes de trois,
 * greffe sans « RCS de », nationalité accordée au féminin, majuscule ou minuscule initiale.
 * Aucune chaîne n'est mise en forme typographique ici : l'écran passe le texte par `fr()`.
 */

/** « Monsieur » donne « M. », « Madame » « Mme », « Maître » « Me » ; toute autre civilité reste telle qu'écrite. */
export function civiliteActe(civilite: string | null | undefined): string {
  const nette = (civilite ?? "").trim();
  if (nette === "Monsieur") return "M.";
  if (nette === "Madame") return "Mme";
  if (nette === "Maître") return "Me";
  return nette;
}

/** Premier prénom (le prénom usuel), les prénoms composés par un trait d'union restant entiers. */
export function prenomUsuel(prenoms: string | null | undefined): string {
  return (prenoms ?? "").trim().split(/\s+/u)[0] ?? "";
}

/** SIREN par groupes de trois chiffres : « 812 345 676 ». Vide si aucun chiffre. */
export function sirenEnGroupes(siren: string | null | undefined): string {
  const chiffres = (siren ?? "").replace(/\D/gu, "");
  return chiffres.replace(/(\d{3})(?=\d)/gu, "$1 ").trim();
}

/** Greffe sans son préfixe : « RCS de Lyon » et « RCS Lyon » donnent « Lyon ». */
export function greffeSansRcs(greffe: string | null | undefined): string {
  return (greffe ?? "").replace(/\s+/gu, " ").trim().replace(/^RCS\s*(?:de\s+|d['’]\s*)?/iu, "").trim();
}

/** Minuscule initiale d'un mot courant ; un sigle (« SARL », « SA à conseil… ») garde ses capitales. */
export function minusculeInitiale(texte: string): string {
  const lettres = Array.from(texte);
  const premiere = lettres[0];
  if (premiere === undefined) return texte;
  const seconde = lettres[1];
  if (seconde !== undefined && seconde === seconde.toLocaleUpperCase("fr") && seconde !== seconde.toLocaleLowerCase("fr")) {
    return texte;
  }
  return premiere.toLocaleLowerCase("fr") + lettres.slice(1).join("");
}

/** Féminin d'un adjectif de nationalité : « français » → « française », « italien » → « italienne », « turc » → « turque ». */
function adjectifFeminin(mot: string): string {
  const bas = mot.toLocaleLowerCase("fr");
  if (bas === "") return bas;
  if (bas.endsWith("e")) return bas;
  if (bas === "grec") return "grecque";
  if (bas.endsWith("c")) return `${bas.slice(0, -1)}que`;
  if (bas.endsWith("en")) return `${bas}ne`;
  return `${bas}e`;
}

/** Seul le dernier élément d'un adjectif composé s'accorde : « franco-marocain » donne « franco-marocaine ». */
function accorderDernier(compose: string): string {
  const parties = compose.split("-");
  const dernier = parties.pop() ?? "";
  return [...parties.map((partie) => partie.toLocaleLowerCase("fr")), adjectifFeminin(dernier)].join("-");
}

/**
 * Nationalité telle qu'elle suit « de nationalité » : le nom « nationalité » est féminin, l'adjectif s'accorde
 * avec lui quel que soit le sexe de la personne (« de nationalité française » pour un homme comme pour une femme).
 * Les nationalités multiples (« française et marocain », « française, marocaine ») s'accordent une à une.
 */
export function nationaliteAccordee(nationalite: string | null | undefined): string {
  const nette = (nationalite ?? "").replace(/\s+/gu, " ").trim();
  if (nette === "") return "";
  return nette
    .split(/(\s+et\s+|\s*,\s*)/u)
    .map((morceau, index) => (index % 2 === 1 ? morceau : accorderDernier(morceau)))
    .join("");
}
