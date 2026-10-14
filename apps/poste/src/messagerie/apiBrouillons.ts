import { lireSaisie, type Destinataire } from "@/messagerie/adressesRedaction";
import { appeler, type ResultatApi } from "@/messagerie/appelApi";
import { texteDeLaCitationServeur } from "@/messagerie/citation";
import type { ChampsEcrits } from "@/messagerie/etatRedaction";
import { piecesDepuisValeur, type PieceBrouillon } from "@/messagerie/piecesRedaction";
import { corpsBrouillon } from "@/sync/uploadBrouillon";

/**
 * Appels à l'API qui exigent le serveur dans la rédaction : complétion des destinataires, pièces jointes
 * (téléversement en ligne), envoi du brouillon. Le texte du brouillon, lui, ne passe jamais par ici : il est écrit
 * dans la base locale et le connecteur d'envoi du poste le porte à l'API.
 */

export type { ResultatApi };

const DELAI_COURT_MS = 15_000;
const DELAI_PIECE_MS = 120_000;

export type Suggestion = Destinataire & { source: string };

/** Complétion : annuaire du cabinet, adresses déjà écrites, adresses des mails que l'utilisateur peut lire. */
export async function suggererDestinataires(
  instanceUrl: string,
  saisie: string,
): Promise<ResultatApi<Suggestion[]>> {
  const q = saisie.trim();
  if (Array.from(q).length < 2) return { ok: true, valeur: [] };
  return appeler(instanceUrl, "GET", `/messagerie/destinataires?q=${encodeURIComponent(q)}&limite=8`, {
    delaiMs: DELAI_COURT_MS,
    lire: (json) => {
      if (!Array.isArray(json)) return [];
      const suggestions: Suggestion[] = [];
      for (const element of json as unknown[]) {
        if (typeof element !== "object" || element === null) continue;
        const ligne = element as Record<string, unknown>;
        if (typeof ligne.adresse !== "string" || ligne.adresse === "") continue;
        suggestions.push({
          adresse: ligne.adresse,
          nom: typeof ligne.nom === "string" ? ligne.nom : "",
          source: typeof ligne.source === "string" ? ligne.source : "",
        });
      }
      return suggestions;
    },
  });
}

/** Pièces du brouillon telles que la réponse de l'API les résume. */
function piecesDeLaReponse(json: unknown): PieceBrouillon[] {
  if (typeof json !== "object" || json === null) return [];
  return piecesDepuisValeur((json as { pieces?: unknown }).pieces);
}

/**
 * Écrit le brouillon complet sur le serveur, tout de suite, par le même corps que la file d'envoi du poste
 * (écriture partielle rejouable, dernière écriture gagnante). Sert avant un téléversement de pièce ou un envoi :
 * le serveur a alors la dernière version, quoi qu'il en soit de la file.
 */
export function ecrireBrouillonSurServeur(
  instanceUrl: string,
  brouillonId: string,
  champs: ChampsEcrits,
): Promise<ResultatApi<PieceBrouillon[]>> {
  return appeler(instanceUrl, "PUT", `/messagerie/brouillons/${brouillonId}`, {
    corps: JSON.stringify(corpsBrouillon({ ...champs })),
    typeContenu: "application/json",
    delaiMs: DELAI_COURT_MS,
    lire: piecesDeLaReponse,
  });
}

/**
 * Téléverse une pièce en ligne. Le brouillon doit déjà exister sur le serveur (l'appelant attend que la file
 * d'envoi du poste soit vide). `pieceId` rend la requête rejouable sans doublon.
 */
export async function televerserPiece(
  instanceUrl: string,
  brouillonId: string,
  fichier: File,
  pieceId: string,
): Promise<ResultatApi<PieceBrouillon[]>> {
  const chemin = `/messagerie/brouillons/${brouillonId}/pieces?nom=${encodeURIComponent(fichier.name)}&piece_id=${pieceId}`;
  return appeler(instanceUrl, "POST", chemin, {
    corps: fichier,
    typeContenu: fichier.type === "" ? "application/octet-stream" : fichier.type,
    delaiMs: DELAI_PIECE_MS,
    lire: piecesDeLaReponse,
  });
}

export function retirerPiece(
  instanceUrl: string,
  brouillonId: string,
  pieceId: string,
): Promise<ResultatApi<PieceBrouillon[]>> {
  return appeler(instanceUrl, "DELETE", `/messagerie/brouillons/${brouillonId}/pieces/${pieceId}`, {
    delaiMs: DELAI_COURT_MS,
    lire: piecesDeLaReponse,
  });
}

export type EnvoiCree = { id: string; etat: string };

/** Envoie le brouillon : l'API crée la ligne de la file d'envoi puis retire le brouillon et sa copie IMAP. */
export function envoyerBrouillon(instanceUrl: string, brouillonId: string): Promise<ResultatApi<EnvoiCree>> {
  return appeler(instanceUrl, "POST", `/messagerie/brouillons/${brouillonId}/envoyer`, {
    delaiMs: DELAI_PIECE_MS,
    lire: (json) => {
      const ligne = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
      return {
        id: typeof ligne.id === "string" ? ligne.id : brouillonId,
        etat: typeof ligne.etat === "string" ? ligne.etat : "",
      };
    },
  });
}

/** Fait avancer l'envoi dans la file jusqu'à « copie dans Envoyés confirmée » (reprenable : « Envoyés » est consulté avant chaque tentative). */
export function traiterEnvoi(instanceUrl: string, envoiId: string): Promise<ResultatApi<EnvoiCree>> {
  return appeler(instanceUrl, "POST", `/messagerie/file-envoi/${envoiId}/traiter`, {
    delaiMs: DELAI_PIECE_MS,
    lire: (json) => {
      const ligne = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
      return {
        id: typeof ligne.id === "string" ? ligne.id : envoiId,
        etat: typeof ligne.etat === "string" ? ligne.etat : "",
      };
    },
  });
}

/** Départ d'une réponse tel que le serveur le compose : destinataires (sans les adresses du cabinet) et fil complet. */
export type DepartServeur = {
  a: Destinataire[];
  cc: Destinataire[];
  enReponseA: string | null;
  references: string[];
  /** Texte du message d'origine tel que le serveur l'a lu (vide s'il n'a pas pu). */
  texteCite: string;
  /** Compte d'envoi du message : celui du message d'origine. Sa signature est insérée à la rédaction. */
  compteId: string | null;
};

function textes(valeur: unknown): string[] {
  return Array.isArray(valeur) ? (valeur as unknown[]).filter((v): v is string => typeof v === "string") : [];
}

/**
 * Demande au serveur le départ d'une réponse. Il connaît les adresses du cabinet (dont la boîte partagée, qui
 * ne descend pas sur le poste) et la chaîne `References` du fil. Hors ligne, l'appelant garde le départ local.
 */
export function composerDepartServeur(
  instanceUrl: string,
  genre: "reponse" | "reponse_a_tous" | "transfert",
  messageId: string,
): Promise<ResultatApi<DepartServeur>> {
  return appeler(instanceUrl, "POST", "/messagerie/composition", {
    corps: JSON.stringify({ genre, message_id: messageId }),
    typeContenu: "application/json",
    delaiMs: 6_000,
    lire: (json) => {
      const ligne = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
      const enReponseA = typeof ligne.en_reponse_a === "string" && ligne.en_reponse_a.trim() !== "" ? ligne.en_reponse_a : null;
      return {
        a: lireSaisie(textes(ligne.a).join("\n")).destinataires,
        cc: lireSaisie(textes(ligne.cc).join("\n")).destinataires,
        enReponseA,
        references: textes(ligne.references),
        texteCite: typeof ligne.html === "string" ? texteDeLaCitationServeur(ligne.html) : "",
        compteId: typeof ligne.compte_id === "string" && ligne.compte_id !== "" ? ligne.compte_id : null,
      };
    },
  });
}
