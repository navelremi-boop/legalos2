import { initialesDepuis } from "@/lib/initiales";

/** Expéditeur ou destinataire d'un mail : « Me Clément Vasseur <c.vasseur@exemple.fr> » ou une simple adresse. */
export type Correspondant = { nom: string; adresse: string };

const FORME_NOM_ADRESSE = /^\s*"?([^"<]*?)"?\s*<([^<>]+)>\s*$/u;

export function analyserCorrespondant(texte: string | null | undefined): Correspondant {
  const brut = (texte ?? "").trim();
  if (brut === "") return { nom: "", adresse: "" };
  const trouve = FORME_NOM_ADRESSE.exec(brut);
  if (trouve) {
    return { nom: (trouve[1] ?? "").trim(), adresse: (trouve[2] ?? "").trim() };
  }
  if (brut.includes("@")) return { nom: "", adresse: brut.replace(/^mailto:/iu, "") };
  return { nom: brut, adresse: "" };
}

/** Nom à afficher : le nom s'il existe, sinon l'adresse. */
export function nomAffiche(correspondant: Correspondant): string {
  return correspondant.nom !== "" ? correspondant.nom : correspondant.adresse;
}

/** Titres de civilité ou de profession qui précèdent un nom : ils ne comptent pas dans les initiales. */
const TITRES = /^(?:(?:me|maître|maitre|mme|mlle|mr|m|dr|pr)\.?\s+)+/iu;

/** Lettres du monogramme (« Me Clément Vasseur » donne « CV ») ; « ? » quand rien n'en donne. */
export function monogramme(correspondant: Correspondant): string {
  const sansTitre = correspondant.nom.replace(TITRES, "").trim();
  const depuisNom = initialesDepuis(sansTitre === "" ? null : sansTitre, correspondant.adresse);
  return depuisNom ?? "?";
}

/** Découpe une liste de destinataires séparés par des virgules ou des points-virgules (hors guillemets et chevrons). */
export function separerDestinataires(texte: string | null | undefined): string[] {
  const brut = texte ?? "";
  const morceaux: string[] = [];
  let courant = "";
  let dansChevrons = false;
  let dansGuillemets = false;
  for (const caractere of brut) {
    if (caractere === '"') dansGuillemets = !dansGuillemets;
    if (!dansGuillemets) {
      if (caractere === "<") dansChevrons = true;
      if (caractere === ">") dansChevrons = false;
    }
    if ((caractere === "," || caractere === ";") && !dansChevrons && !dansGuillemets) {
      morceaux.push(courant);
      courant = "";
    } else {
      courant += caractere;
    }
  }
  morceaux.push(courant);
  return morceaux.map((morceau) => morceau.trim()).filter((morceau) => morceau !== "");
}

/**
 * Ligne « À … » de l'en-tête de lecture. Une adresse qui est celle d'un compte de l'utilisateur
 * s'écrit « vous ».
 */
export function destinatairesAffiches(
  texte: string | null | undefined,
  adressesPropres: readonly string[],
): string {
  const propres = new Set(adressesPropres.map((adresse) => adresse.trim().toLowerCase()));
  const noms = separerDestinataires(texte).map((morceau) => {
    const correspondant = analyserCorrespondant(morceau);
    if (propres.has(correspondant.adresse.toLowerCase())) return "vous";
    return nomAffiche(correspondant);
  });
  return noms.length === 0 ? "" : noms.join(", ");
}
