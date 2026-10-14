import { nettoyerSortie, texteDepuisHtml } from "@/messagerie/nettoyageHtml";

/**
 * Composition du corps d'un message en cours de rédaction : saisie, signature, historique cité, modèle de message.
 * Fonctions pures sur le HTML que l'éditeur produit (paragraphes, listes, citations) : aucune lecture du DOM,
 * donc testables sans navigateur.
 *
 * Disposition d'un message : la saisie, puis la signature (annoncée par une ligne « -- »), puis, à la fin, l'historique
 * cité d'une réponse ou d'un transfert. La signature est toujours entre la saisie et l'historique.
 */

/** Ligne qui annonce la signature, comme le fait le serveur quand il compose un départ (« -- »). */
export const SEPARATEUR_SIGNATURE = "<p>--</p>";

const PARAGRAPHE_VIDE = "<p></p>";

/** Blocs de premier niveau d'un HTML produit par l'éditeur (p, ul, ol, blockquote). Un texte hors bloc est ignoré. */
export function decouperBlocs(html: string): string[] {
  const blocs: string[] = [];
  let profondeur = 0;
  let debut = 0;
  for (const trouve of html.matchAll(/<(\/?)(p|ul|ol|blockquote)\b[^>]*>/giu)) {
    const position = trouve.index;
    if (trouve[1] !== "/") {
      if (profondeur === 0) debut = position;
      profondeur += 1;
      continue;
    }
    profondeur = Math.max(0, profondeur - 1);
    if (profondeur === 0) blocs.push(html.slice(debut, position + trouve[0].length));
  }
  return blocs;
}

export type PartiesCorps = {
  /** Ce que l'utilisateur écrit : au-dessus de la signature. */
  saisie: string[];
  /** Ligne « -- » et signature ; vide si le message n'en porte pas. */
  signature: string[];
  /** Citation finale d'une réponse ou d'un transfert ; vide pour un message neuf. */
  historique: string[];
};

/** Sépare le corps en saisie, signature et historique. */
export function separerCorps(html: string): PartiesCorps {
  const blocs = decouperBlocs(html);
  const dernier = blocs[blocs.length - 1];
  const historique = dernier !== undefined && /^<blockquote\b/iu.test(dernier) ? [dernier] : [];
  const corps = blocs.slice(0, blocs.length - historique.length);
  const separateur = corps.indexOf(SEPARATEUR_SIGNATURE);
  if (separateur === -1) return { saisie: corps, signature: [], historique };
  return { saisie: corps.slice(0, separateur), signature: corps.slice(separateur), historique };
}

export function assemblerCorps(parties: PartiesCorps): string {
  return [...parties.saisie, ...parties.signature, ...parties.historique].join("");
}

/** Vrai si les blocs ne portent aucun texte (paragraphes vides, retours à la ligne seuls). */
export function blocsSansTexte(blocs: readonly string[]): boolean {
  return texteDepuisHtml(blocs.join("")) === "";
}

/** Blocs de la signature, séparateur compris ; liste vide quand la signature ne porte aucun texte. */
export function blocsSignature(signatureHtml: string): string[] {
  const propre = nettoyerSortie(signatureHtml).trim();
  if (texteDepuisHtml(propre) === "") return [];
  const blocs = decouperBlocs(propre);
  return [SEPARATEUR_SIGNATURE, ...(blocs.length > 0 ? blocs : [`<p>${propre}</p>`])];
}

/**
 * Le corps avec cette signature, une seule fois : celle qui s'y trouvait est remplacée, ou retirée si la nouvelle est vide.
 * Elle se place sous la saisie et avant l'historique cité.
 */
export function avecSignature(corpsHtml: string, signatureHtml: string): string {
  const parties = separerCorps(corpsHtml);
  const signature = blocsSignature(signatureHtml);
  const saisie = parties.saisie.length === 0 && signature.length > 0 ? [PARAGRAPHE_VIDE] : parties.saisie;
  return assemblerCorps({ saisie, signature, historique: parties.historique });
}

/** Modèle de message du cabinet, tel que l'API le sert. */
export type ModeleMessage = {
  id: string;
  nom: string;
  objet: string;
  corpsHtml: string;
};

export type PlanModele = {
  objet: string;
  corpsHtml: string;
  /**
   * Vrai quand appliquer le modèle remplacerait quelque chose que l'utilisateur a écrit : l'écran demande alors
   * confirmation avant de l'appliquer. Faux : le plan s'applique tel quel, rien n'est écrasé.
   */
  confirmation: boolean;
  /** Ce que le modèle remplacerait, pour la phrase de confirmation. */
  remplace: ("texte" | "objet")[];
};

/**
 * Ce que donne le choix d'un modèle sur le message en cours.
 * - Le corps du modèle prend la place de la saisie ; la signature et l'historique cité restent où ils sont.
 * - L'objet du modèle n'entre que dans un message neuf : l'objet d'une réponse ou d'un transfert est celui du fil.
 * - Rien de ce que l'utilisateur a écrit n'est remplacé sans confirmation : saisie non vide, ou objet déjà saisi et différent.
 */
export function planModele(
  courant: { genre: string; objet: string; corpsHtml: string },
  modele: ModeleMessage,
): PlanModele {
  const parties = separerCorps(courant.corpsHtml);
  const blocsModele = decouperBlocs(nettoyerSortie(modele.corpsHtml));
  const modeleSansTexte = blocsSansTexte(blocsModele);

  const remplace: ("texte" | "objet")[] = [];
  let corpsHtml = courant.corpsHtml;
  if (!modeleSansTexte) {
    if (!blocsSansTexte(parties.saisie)) remplace.push("texte");
    corpsHtml = assemblerCorps({ ...parties, saisie: blocsModele });
  }

  const objetModele = modele.objet.trim();
  const objetCourant = courant.objet.trim();
  let objet = courant.objet;
  if (courant.genre === "nouveau" && objetModele !== "") {
    if (objetCourant !== "" && objetCourant !== objetModele) remplace.push("objet");
    objet = objetModele;
  }

  return { objet, corpsHtml, confirmation: remplace.length > 0, remplace };
}

/** Phrase de confirmation avant de remplacer ce que l'utilisateur a écrit. */
export function phraseConfirmationModele(nomModele: string, remplace: readonly ("texte" | "objet")[]): string {
  const quoi = remplace.length === 2 ? "votre texte et votre objet" : remplace[0] === "objet" ? "votre objet" : "votre texte";
  return `Le modèle « ${nomModele} » remplacera ${quoi}.`;
}
