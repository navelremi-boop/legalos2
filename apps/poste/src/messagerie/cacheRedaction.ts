import type { ModeleMessage } from "@/messagerie/corpsRedaction";

/**
 * Dernière copie, sur ce poste, de ce que la rédaction lit à l'API : signatures de l'utilisateur et modèles de message.
 * Elle sert hors ligne et le temps que le serveur réponde ; le serveur reste la source de vérité et la copie est
 * remplacée à chaque lecture réussie. Elle est propre à un utilisateur : celle d'un autre utilisateur n'est jamais lue.
 * Aucun secret : des textes que l'utilisateur a lui-même rédigés.
 */

export type StockageTexte = Pick<Storage, "getItem" | "setItem">;

export type CacheRedaction = {
  utilisateurId: string;
  /** HTML de la signature, par compte. Absente : jamais lue ; chaîne vide : lue, aucune signature. */
  signatures: Record<string, string>;
  /** Compte dont la signature s'applique à un message neuf (celui que le serveur a désigné). */
  compteNouveau: string | null;
  /** Modèles actifs du cabinet ; `null` : jamais lus. */
  modeles: ModeleMessage[] | null;
};

export const CLE_CACHE_REDACTION = "legalos.redaction.v1";

export function cacheVide(utilisateurId: string): CacheRedaction {
  return { utilisateurId, signatures: {}, compteNouveau: null, modeles: null };
}

function estTexte(valeur: unknown): valeur is string {
  return typeof valeur === "string";
}

function lireModeleCache(valeur: unknown): ModeleMessage | null {
  if (typeof valeur !== "object" || valeur === null) return null;
  const ligne = valeur as Record<string, unknown>;
  if (!estTexte(ligne.id) || !estTexte(ligne.nom)) return null;
  return {
    id: ligne.id,
    nom: ligne.nom,
    objet: estTexte(ligne.objet) ? ligne.objet : "",
    corpsHtml: estTexte(ligne.corpsHtml) ? ligne.corpsHtml : "",
  };
}

/** Relit la copie avec prudence : une copie illisible ou d'un autre utilisateur vaut une copie vide. */
export function lireCacheDepuisTexte(texte: string | null, utilisateurId: string): CacheRedaction {
  if (texte === null) return cacheVide(utilisateurId);
  try {
    const brut = JSON.parse(texte) as unknown;
    if (typeof brut !== "object" || brut === null) return cacheVide(utilisateurId);
    const ligne = brut as Record<string, unknown>;
    if (ligne.utilisateurId !== utilisateurId) return cacheVide(utilisateurId);
    const signatures: Record<string, string> = {};
    if (typeof ligne.signatures === "object" && ligne.signatures !== null) {
      for (const [compte, html] of Object.entries(ligne.signatures as Record<string, unknown>)) {
        if (estTexte(html)) signatures[compte] = html;
      }
    }
    const modeles = Array.isArray(ligne.modeles)
      ? (ligne.modeles as unknown[]).flatMap((m) => {
          const lu = lireModeleCache(m);
          return lu === null ? [] : [lu];
        })
      : null;
    return {
      utilisateurId,
      signatures,
      compteNouveau: estTexte(ligne.compteNouveau) && ligne.compteNouveau !== "" ? ligne.compteNouveau : null,
      modeles,
    };
  } catch {
    return cacheVide(utilisateurId);
  }
}

export function cacheVersTexte(cache: CacheRedaction): string {
  return JSON.stringify(cache);
}

/** Stockage du navigateur de l'application, `null` s'il est inaccessible (la rédaction fonctionne alors sans copie). */
export function stockageNavigateur(): StockageTexte | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function lireCache(stockage: StockageTexte | null, utilisateurId: string | null): CacheRedaction | null {
  if (utilisateurId === null) return null;
  try {
    return lireCacheDepuisTexte(stockage === null ? null : stockage.getItem(CLE_CACHE_REDACTION), utilisateurId);
  } catch {
    return cacheVide(utilisateurId);
  }
}

/** Modifie la copie : relecture, changement, écriture. Sans stockage ou sans utilisateur, ne fait rien. */
export function majCache(
  stockage: StockageTexte | null,
  utilisateurId: string | null,
  changer: (cache: CacheRedaction) => CacheRedaction,
): void {
  if (stockage === null || utilisateurId === null) return;
  try {
    const courant = lireCache(stockage, utilisateurId) ?? cacheVide(utilisateurId);
    stockage.setItem(CLE_CACHE_REDACTION, cacheVersTexte(changer(courant)));
  } catch {
    /* stockage plein ou refusé : la rédaction n'en dépend pas */
  }
}
