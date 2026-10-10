/**
 * Initiales affichées dans l'avatar du compte : première lettre du premier et du dernier mot du nom
 * (« Jeanne Moreau » → « JM »), sinon de l'adresse (« jeanne.moreau@cabinet » → « JM »). Une seule
 * lettre pour un seul mot. `null` quand ni le nom ni l'adresse ne donnent une lettre.
 */
function premiereLettre(mot: string): string {
  const lettre = Array.from(mot.trim())[0];
  return lettre === undefined ? "" : lettre.toLocaleUpperCase("fr");
}

function initialesDeMots(mots: string[]): string | null {
  const utiles = mots.map((m) => m.trim()).filter((m) => m !== "");
  const premier = utiles[0];
  if (premier === undefined) return null;
  const dernier = utiles.length > 1 ? utiles[utiles.length - 1] : undefined;
  const sortie = premiereLettre(premier) + (dernier === undefined ? "" : premiereLettre(dernier));
  return sortie === "" ? null : sortie;
}

export function initialesDepuis(nom: string | null | undefined, email: string | null | undefined): string | null {
  const depuisNom = initialesDeMots((nom ?? "").split(/[\s-]+/));
  if (depuisNom !== null) return depuisNom;
  const local = (email ?? "").split("@")[0] ?? "";
  return initialesDeMots(local.split(/[._+-]+/));
}
