import type { FournisseurOAuth } from "@/messagerie/formesOAuth";
import type { RecetteHooks } from "@/sync/recetteHooks";

/**
 * Point d'extension de recette de la connexion OAuth : en recette (`VITE_LEGALOS_RECETTE_HOOKS=1`, build de test
 * seulement), la recette fait elle-même la requête du « navigateur » et branche le fournisseur simulé.
 *
 * Dans le build distribué la constante vaut autre chose : chaque fonction ci-dessous se réduit à sa valeur neutre,
 * le crochet n'est pas embarqué (`tests/recette/galerie-absente.mjs` le vérifie sur le bundle), l'adresse
 * d'autorisation s'ouvre toujours dans le navigateur du système, en `https` seulement, et le fournisseur
 * « simulateur » n'est jamais proposé. Le test de la constante reste écrit en toutes lettres dans chaque fonction :
 * c'est ce qui permet au bundleur de retirer le code de recette.
 */

export type CrochetOAuthRecette = {
  /** Fournisseurs ajoutés à la liste de l'instance (recette : « simulateur »). */
  fournisseurs: FournisseurOAuth[];
  /** Champs ajoutés au corps de `POST /messagerie/oauth/debut`, par fournisseur (adresses du fournisseur simulé). */
  supplementsDebut: Record<string, Record<string, unknown>>;
  /** Adresses d'autorisation que l'app aurait ouvertes dans le navigateur du système, dans l'ordre. */
  adressesOuvertes: string[];
  /** Branche le fournisseur simulé (données seulement : aucune fonction ne traverse le protocole de pilotage). */
  configurer: (config: {
    fournisseurs: FournisseurOAuth[];
    supplementsDebut: Record<string, Record<string, unknown>>;
  }) => void;
};

export function creerCrochetOAuthRecette(): CrochetOAuthRecette {
  const crochet: CrochetOAuthRecette = {
    fournisseurs: [],
    supplementsDebut: {},
    adressesOuvertes: [],
    configurer(config) {
      crochet.fournisseurs = config.fournisseurs;
      crochet.supplementsDebut = config.supplementsDebut;
    },
  };
  return crochet;
}

function crochet(): CrochetOAuthRecette | null {
  const hooks: RecetteHooks | undefined = window.__legalosRecette;
  return hooks?.oauth ?? null;
}

/** Fournisseurs que la recette ajoute à la liste de l'instance (toujours vide hors recette). */
export function fournisseursDeRecette(): FournisseurOAuth[] {
  if (import.meta.env.VITE_LEGALOS_RECETTE_HOOKS !== "1") return [];
  return crochet()?.fournisseurs ?? [];
}

/** Champs que la recette joint au début de connexion d'un fournisseur (jamais hors recette). */
export function supplementDeRecette(fournisseur: string): Record<string, unknown> | undefined {
  if (import.meta.env.VITE_LEGALOS_RECETTE_HOOKS !== "1") return undefined;
  return crochet()?.supplementsDebut[fournisseur];
}

/** Vrai en recette : l'adresse d'autorisation du fournisseur simulé est en `http` sur la boucle locale. */
export function recetteAutoriseHttp(): boolean {
  if (import.meta.env.VITE_LEGALOS_RECETTE_HOOKS !== "1") return false;
  return crochet() !== null;
}

/**
 * Remet l'adresse à la recette au lieu du navigateur du système ; `false` si aucun crochet (toujours le cas hors
 * recette) : l'appelant ouvre alors le navigateur du système.
 */
export function confierAdresseALaRecette(adresse: string): boolean {
  if (import.meta.env.VITE_LEGALOS_RECETTE_HOOKS !== "1") return false;
  const courant = crochet();
  if (courant === null) return false;
  courant.adressesOuvertes.push(adresse);
  return true;
}
