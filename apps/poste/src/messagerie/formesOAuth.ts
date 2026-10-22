import type { RequeteApi } from "@/messagerie/formesApiRedaction";

/**
 * Connexion d'une boîte par OAuth (Microsoft 365, Gmail) : corps des requêtes, validation du retour du navigateur,
 * libellés et messages en français. Pures : le réseau, l'écoute locale et le navigateur sont dans `apiOAuthBoites.ts`.
 * Contrat : `docs/oauth-messagerie.md` et `crates/api/src/routes/` (`/messagerie/oauth/…`).
 *
 * Le poste ne voit jamais un jeton : il transmet à l'instance le code d'autorisation que le navigateur lui a rendu,
 * et l'instance seule échange ce code (avec le vérificateur PKCE qu'elle détient) et garde les jetons.
 */

export type FournisseurOAuth = { id: string; libelle: string };

const LIBELLES_FOURNISSEURS: Record<string, string> = {
  microsoft: "Microsoft 365",
  gmail: "Gmail",
  simulateur: "Fournisseur de test",
};

/** Les seuls fournisseurs que le poste propose de lui-même : ceux que l'instance annonce, parmi ces deux. */
const FOURNISSEURS_PROPOSES = ["microsoft", "gmail"] as const;

/** « Microsoft 365 », « Gmail » ; un identifiant inconnu est rendu tel quel, `null` donne une chaîne vide. */
export function libelleFournisseur(id: string | null): string {
  if (id === null || id === "") return "";
  return LIBELLES_FOURNISSEURS[id] ?? id;
}

export function requeteFournisseurs(): { methode: "GET"; chemin: string } {
  return { methode: "GET", chemin: "/messagerie/oauth/fournisseurs" };
}

function objet(json: unknown): Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

/**
 * Fournisseurs que l'instance sait connecter. Un identifiant que le poste ne connaît pas est ignoré (jamais proposé),
 * un doublon aussi ; le libellé est celui du poste, pas un texte venu du réseau. Réponse illisible : liste vide.
 */
export function lireFournisseurs(json: unknown): FournisseurOAuth[] {
  const liste = objet(json).fournisseurs;
  if (!Array.isArray(liste)) return [];
  const ids = new Set<string>();
  for (const element of liste as unknown[]) {
    const id = objet(element).id;
    if (typeof id === "string" && (FOURNISSEURS_PROPOSES as readonly string[]).includes(id)) ids.add(id);
  }
  return FOURNISSEURS_PROPOSES.filter((id) => ids.has(id)).map((id) => ({ id, libelle: libelleFournisseur(id) }));
}

/** Adresse de bouclage que le poste écoute : exactement `http://127.0.0.1:<port>/` (port non privilégié). */
export function redirectionBouclage(port: number): string | null {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) return null;
  return `http://127.0.0.1:${String(port)}/`;
}

export type DemandeDebut = {
  id: string;
  adresse: string;
  fournisseur: string;
  redirection: string;
  /** Champs que la recette ajoute pour le fournisseur simulé ; ne remplacent jamais les quatre champs du contrat. */
  supplement?: Record<string, unknown>;
};

export function requeteDebut(demande: DemandeDebut): RequeteApi {
  return {
    methode: "POST",
    chemin: "/messagerie/oauth/debut",
    corps: {
      ...(demande.supplement ?? {}),
      id: demande.id,
      adresse: demande.adresse.trim(),
      fournisseur: demande.fournisseur,
      redirection: demande.redirection,
    },
  };
}

export type DebutOAuth = { state: string; url: string };

export function lireDebut(json: unknown): DebutOAuth | null {
  const racine = objet(json);
  const { state, url } = racine;
  if (typeof state !== "string" || state === "" || typeof url !== "string" || url === "") return null;
  return { state, url };
}

/**
 * L'adresse d'autorisation s'ouvre dans le navigateur du système : `https` seulement (les fournisseurs réels n'ont pas
 * d'autre adresse). Le `http` n'est admis qu'en recette, pour le fournisseur simulé sur la boucle locale.
 */
export function adresseAutorisationOuvrable(adresse: string, autoriserHttp: boolean): boolean {
  let url: URL;
  try {
    url = new URL(adresse);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  return url.protocol === "https:" || (autoriserHttp && url.protocol === "http:");
}

export function requeteEchange(state: string, code: string): RequeteApi {
  return { methode: "POST", chemin: "/messagerie/oauth/echange", corps: { state, code } };
}

export type EchangeOAuth = { id: string; adresse: string; fournisseur: string; reconnexion: boolean };

export function lireEchange(json: unknown): EchangeOAuth | null {
  const racine = objet(json);
  if (typeof racine.id !== "string" || racine.id === "") return null;
  return {
    id: racine.id,
    adresse: typeof racine.adresse === "string" ? racine.adresse : "",
    fournisseur: typeof racine.fournisseur === "string" ? racine.fournisseur : "",
    reconnexion: racine.reconnexion === true,
  };
}

/** Ce que la commande d'attente du poste rend : un code et un `state`, ou une erreur. */
export type RetourBouclage = { code: string | null; state: string | null; erreur: string | null };

export function lireRetourBouclage(json: unknown): RetourBouclage {
  const racine = objet(json);
  const texte = (valeur: unknown): string | null => (typeof valeur === "string" && valeur !== "" ? valeur : null);
  return { code: texte(racine.code), state: texte(racine.state), erreur: texte(racine.erreur) };
}

export type VerdictRetour =
  | { ok: true; code: string; state: string }
  | { ok: false; annule: boolean; message: string };

export const MESSAGE_ANNULE = "Connexion annulée.";
export const MESSAGE_RETOUR_INCOHERENT =
  "La réponse du navigateur ne correspond pas à la demande de connexion. Par sécurité elle a été ignorée : recommencez.";
export const MESSAGE_RETOUR_INCOMPLET = "La réponse du navigateur est incomplète. Recommencez.";

/** Message pour le code d'erreur rendu par l'écoute locale ou repris du fournisseur (`error=…`). */
export function messageErreurRetour(erreur: string): string {
  switch (erreur) {
    case "annule":
      return MESSAGE_ANNULE;
    case "delai_depasse":
      return "Le délai est dépassé : le navigateur n'a pas répondu en 10 minutes. Recommencez.";
    case "access_denied":
      return "L'autorisation a été refusée dans le navigateur. La boîte n'a pas été connectée.";
    case "temporarily_unavailable":
    case "server_error":
      return "Le fournisseur est momentanément indisponible. Réessayez dans quelques minutes.";
    default:
      return /^[a-z_]{1,40}$/u.test(erreur)
        ? `Le fournisseur a refusé la connexion (${erreur}).`
        : "Le fournisseur a refusé la connexion.";
  }
}

/**
 * Valide le retour du navigateur avant d'en envoyer quoi que ce soit à l'instance : pas d'erreur, un code non vide,
 * et un `state` identique à celui de la demande (sinon la réponse n'est pas pour cette demande).
 */
export function validerRetour(retour: RetourBouclage, stateAttendu: string): VerdictRetour {
  if (retour.erreur !== null) {
    return { ok: false, annule: retour.erreur === "annule", message: messageErreurRetour(retour.erreur) };
  }
  if (retour.code === null || retour.state === null) {
    return { ok: false, annule: false, message: MESSAGE_RETOUR_INCOMPLET };
  }
  if (stateAttendu === "" || retour.state !== stateAttendu) {
    return { ok: false, annule: false, message: MESSAGE_RETOUR_INCOHERENT };
  }
  return { ok: true, code: retour.code, state: retour.state };
}

export type PhaseAppelOAuth = "debut" | "echange";

/**
 * Message pour un échec d'appel à l'instance. Statut 0 : instance injoignable. À l'échange, 404 est une demande
 * inconnue, expirée ou déjà utilisée, et 400 un échange refusé par le fournisseur.
 */
export function messageEchecAppel(phase: PhaseAppelOAuth, statut: number, messageServeur: string): string {
  if (statut === 0) return "L'instance est injoignable.";
  if (phase === "echange") {
    if (statut === 404) return "La demande de connexion a expiré ou a déjà été utilisée. Recommencez.";
    if (statut === 400) {
      return "Le fournisseur a refusé d'échanger l'autorisation. Recommencez ; si cela se répète, prévenez l'administrateur.";
    }
  }
  if (statut === 401) return "La session a expiré. Reconnectez-vous.";
  if (phase === "debut" && statut === 400 && messageServeur.trim() !== "") return messageServeur.trim();
  return phase === "debut"
    ? "L'instance n'a pas pu préparer la connexion. Réessayez."
    : "L'instance n'a pas pu terminer la connexion. Réessayez.";
}

export type EtapeOAuth = "ouverture" | "attente" | "echange";

export function libelleEtape(etape: EtapeOAuth): string {
  switch (etape) {
    case "ouverture":
      return "Ouverture du navigateur…";
    case "attente":
      return "En attente de l'autorisation dans le navigateur…";
    case "echange":
      return "Finalisation de la connexion…";
  }
}
