import { paragraphesHtml } from "@/messagerie/citation";
import type { ModeleMessage } from "@/messagerie/corpsRedaction";

/**
 * Forme des appels à l'API pour les signatures, les modèles de message et le compte de composition, et lecture de
 * ses réponses. Pures : le réseau est dans `apiRedactionCabinet.ts`. Contrat : `crates/api/src/routes/redaction.rs`.
 */

export type RequeteApi = {
  methode: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  chemin: string;
  corps?: Record<string, unknown>;
};

function objet(json: unknown): Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur : "";
}

// ----- Comptes -----

export type CompteMessagerie = {
  id: string;
  adresse: string;
  /** `nominatif`, `partage` ou `classement`. */
  typeCompte: string;
};

/** Intitulé d'une boîte dans les réglages : `nominatif` (la sienne), `partage` ou `classement` (celle du cabinet). */
export function libelleTypeCompte(typeCompte: string): { titre: string } {
  switch (typeCompte) {
    case "nominatif":
      return { titre: "Ma boîte" };
    case "partage":
      return { titre: "Boîte partagée" };
    case "classement":
      return { titre: "Boîte du cabinet" };
    default:
      return { titre: "Boîte" };
  }
}

export function requeteComptes(): RequeteApi {
  return { methode: "GET", chemin: "/messagerie/comptes" };
}

export function lireComptes(json: unknown): CompteMessagerie[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown[]).flatMap((element) => {
    const ligne = objet(element);
    const id = texte(ligne.id);
    if (id === "") return [];
    return [{ id, adresse: texte(ligne.adresse), typeCompte: texte(ligne.type_compte) }];
  });
}

// ----- Signature (une par compte et par utilisateur) -----

export type SignatureCompte = {
  compteId: string;
  /** HTML de la signature ; vide : aucune. */
  html: string;
  /** 0 tant qu'aucune signature n'est enregistrée. */
  revision: number;
};

export function requeteLireSignature(compteId: string): RequeteApi {
  return { methode: "GET", chemin: `/messagerie/comptes/${compteId}/signature` };
}

export function requeteEcrireSignature(compteId: string, html: string): RequeteApi {
  return { methode: "PUT", chemin: `/messagerie/comptes/${compteId}/signature`, corps: { html } };
}

/** Réponse de la signature : le HTML, ou à défaut le texte (une signature écrite sans mise en forme) mis en paragraphes. */
export function lireSignature(json: unknown, compteIdDemande: string): SignatureCompte {
  const ligne = objet(json);
  const html = texte(ligne.html).trim();
  const brut = texte(ligne.texte).trim();
  return {
    compteId: texte(ligne.compte_id) || compteIdDemande,
    html: html !== "" ? html : brut !== "" ? paragraphesHtml(brut) : "",
    revision: typeof ligne.revision === "number" ? ligne.revision : 0,
  };
}

// ----- Compte de composition -----

/** Le serveur désigne le compte d'un message : celui du message d'origine, ou la boîte du cabinet pour un message neuf. */
export function requeteCompteDeComposition(genre: "nouveau" | "reponse" | "reponse_a_tous" | "transfert", messageId: string | null): RequeteApi {
  return {
    methode: "POST",
    chemin: "/messagerie/composition",
    corps: messageId === null ? { genre } : { genre, message_id: messageId },
  };
}

export function lireCompteDeComposition(json: unknown): string | null {
  const id = texte(objet(json).compte_id);
  return id === "" ? null : id;
}

// ----- Modèles de message du cabinet -----

export type ChampsModele = { nom: string; objet: string; corpsHtml: string };

/** Limites de l'API (`redaction.rs`) : le nom et l'objet d'un modèle, la signature. */
export const NOM_MODELE_MAX = 120;
export const OBJET_MODELE_MAX = 300;
export const SIGNATURE_MAX = 20_000;

/** Phrase qui dit pourquoi ces champs ne peuvent pas devenir un modèle ; `null` : ils conviennent. L'API vérifie aussi. */
export function problemeModele(champs: ChampsModele): string | null {
  const nom = champs.nom.trim();
  if (nom === "") return "Donnez un nom au modèle.";
  if (Array.from(nom).length > NOM_MODELE_MAX) return `Le nom du modèle ne peut pas dépasser ${String(NOM_MODELE_MAX)} caractères.`;
  if (/\p{Cc}/u.test(nom) || /\p{Cc}/u.test(champs.objet)) return "Le nom et l'objet ne peuvent pas contenir de retour à la ligne.";
  if (Array.from(champs.objet).length > OBJET_MODELE_MAX) return `L'objet ne peut pas dépasser ${String(OBJET_MODELE_MAX)} caractères.`;
  return null;
}

export function requeteModeles(): RequeteApi {
  return { methode: "GET", chemin: "/messagerie/modeles" };
}

export function requeteCreerModele(id: string, champs: ChampsModele, ordre = 0): RequeteApi {
  return {
    methode: "POST",
    chemin: "/messagerie/modeles",
    corps: { id, nom: champs.nom, objet: champs.objet, corps_html: champs.corpsHtml, ordre },
  };
}

export function requeteModifierModele(id: string, champs: Partial<ChampsModele>): RequeteApi {
  const corps: Record<string, unknown> = {};
  if (champs.nom !== undefined) corps.nom = champs.nom;
  if (champs.objet !== undefined) corps.objet = champs.objet;
  if (champs.corpsHtml !== undefined) corps.corps_html = champs.corpsHtml;
  return { methode: "PATCH", chemin: `/messagerie/modeles/${id}`, corps };
}

export function requeteSupprimerModele(id: string): RequeteApi {
  return { methode: "DELETE", chemin: `/messagerie/modeles/${id}` };
}

export function lireModele(json: unknown): ModeleMessage | null {
  const ligne = objet(json);
  const id = texte(ligne.id);
  if (id === "") return null;
  return { id, nom: texte(ligne.nom), objet: texte(ligne.objet), corpsHtml: texte(ligne.corps_html) };
}

export function lireModeles(json: unknown): ModeleMessage[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown[]).flatMap((element) => {
    const modele = lireModele(element);
    return modele === null ? [] : [modele];
  });
}
