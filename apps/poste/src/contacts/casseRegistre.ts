/**
 * Casse normale des communes et des adresses que le registre des entreprises donne en capitales
 * (« 5 AVENUE DE L'INDUSTRIE 69800 SAINT-PRIEST » devient « 5 avenue de l'Industrie 69800 Saint-Priest »).
 *
 * - Un texte qui contient déjà une minuscule est rendu tel quel : ce que l'utilisateur a saisi n'est jamais retouché.
 * - Particules et articles en minuscules (de, du, des, la, le, les, sur, sous, en, et, d', l'), sauf en tête
 *   d'un nom (« Le Mans », « La Rochelle »).
 * - Mots composés par un trait d'union : chaque élément prend la majuscule, sauf les particules (« Villefranche-sur-Saône »).
 * - Type de voie en minuscules après le numéro (rue, avenue, boulevard, chemin, place, impasse, allée, route, quai,
 *   cours, zone…).
 * - La dénomination d'une société ne passe jamais par ce module : elle reste telle que le registre la donne.
 * - Les accents que le registre n'a pas écrits ne sont pas rétablis.
 */

const PARTICULES: ReadonlySet<string> = new Set(["de", "du", "des", "la", "le", "les", "sur", "sous", "en", "et", "au", "aux", "à"]);

const TYPES_DE_VOIE: ReadonlySet<string> = new Set([
  "rue",
  "avenue",
  "boulevard",
  "chemin",
  "place",
  "impasse",
  "allée",
  "allee",
  "route",
  "quai",
  "cours",
  "zone",
  "passage",
  "square",
  "sentier",
  "voie",
  "esplanade",
  "rond-point",
  "lotissement",
  "résidence",
  "residence",
  "promenade",
  "montée",
  "cité",
]);

const SUFFIXES_DE_NUMERO: ReadonlySet<string> = new Set(["bis", "ter", "quater"]);

const SIGLES: ReadonlySet<string> = new Set(["ZAC", "ZI", "ZA", "BP", "CS", "CC", "CEDEX", "RN", "RD", "CD"]);

const ELISIONS: ReadonlySet<string> = new Set(["l", "d"]);

const CHIFFRES_ROMAINS = /^(?=[IVX])(XXX|XX|X)?(IX|IV|V?I{0,3})$/u;

function majusculeInitiale(mot: string): string {
  const lettres = Array.from(mot);
  const premiere = lettres[0];
  return premiere === undefined ? mot : premiere.toLocaleUpperCase("fr") + lettres.slice(1).join("");
}

/** Un texte tout en capitales : il contient des lettres et aucune minuscule. */
export function estEnCapitales(texte: string): boolean {
  return /\p{L}/u.test(texte) && texte === texte.toLocaleUpperCase("fr");
}

/** Un élément (sans trait d'union ni espace) : `debut` vrai quand une particule doit prendre la majuscule. */
function casserElement(element: string, debut: boolean): string {
  const bas = element.toLocaleLowerCase("fr");
  const apostrophe = /^(.*?)(['’])(.+)$/u.exec(bas);
  if (apostrophe !== null) {
    const tete = apostrophe[1] ?? "";
    const reste = apostrophe[3] ?? "";
    const teteCasee = ELISIONS.has(tete) && !debut ? tete : majusculeInitiale(tete);
    return `${teteCasee}${apostrophe[2] ?? "'"}${casserElement(reste, true)}`;
  }
  if (SIGLES.has(element.toLocaleUpperCase("fr")) && element === element.toLocaleUpperCase("fr")) return element;
  if (element.length > 1 && CHIFFRES_ROMAINS.test(element)) return element;
  if (!debut && PARTICULES.has(bas)) return bas;
  return majusculeInitiale(bas);
}

function casserMot(mot: string, debut: boolean): string {
  return mot
    .split("-")
    .map((element, index) => casserElement(element, index === 0 ? debut : false))
    .join("-");
}

type Position = "debut" | "numero" | "postal" | "mot";

/**
 * Remet en casse normale un texte du registre (commune ou adresse en une ligne). Rendu inchangé s'il n'est pas
 * entièrement en capitales.
 */
export function casseRegistre(texte: string | null | undefined): string | null {
  if (texte === null || texte === undefined) return null;
  if (!estEnCapitales(texte)) return texte;
  let position: Position = "debut";
  return texte
    .split(/(\s+)/u)
    .map((jeton) => {
      if (jeton.trim() === "") return jeton;
      const decoupe = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(jeton);
      const avant = decoupe?.[1] ?? "";
      const mot = decoupe?.[2] ?? jeton;
      const apres = decoupe?.[3] ?? "";
      if (!/\p{L}/u.test(mot)) {
        position = /^\d{5}$/u.test(mot) ? "postal" : /^\d+$/u.test(mot) ? "numero" : position;
        return jeton;
      }
      const bas = mot.toLocaleLowerCase("fr");
      let resultat: string;
      if (/^\d+\p{L}$/u.test(mot)) {
        // « 12B » : numéro avec lettre, la lettre reste en capitale.
        resultat = mot;
        position = "numero";
      } else if (position === "numero" && SUFFIXES_DE_NUMERO.has(bas)) {
        resultat = bas;
      } else if (position === "numero" && TYPES_DE_VOIE.has(bas)) {
        resultat = bas;
        position = "mot";
      } else {
        resultat = casserMot(mot, position === "debut" || position === "postal" || position === "numero");
        position = "mot";
      }
      return `${avant}${resultat}${apres}`;
    })
    .join("");
}

/** Commune en casse normale : « SAINT-PRIEST » donne « Saint-Priest », « LE MANS » donne « Le Mans ». */
export function casseCommune(commune: string | null | undefined): string | null {
  return casseRegistre(commune);
}

/** Adresse en casse normale : « 5 AVENUE DE L'INDUSTRIE » donne « 5 avenue de l'Industrie ». */
export function casseAdresse(adresse: string | null | undefined): string | null {
  return casseRegistre(adresse);
}
