/**
 * Erreurs JavaScript non capturées du poste, remises au journal d'erreurs de l'app (J11, D4, consigne de l'architecte du
 * 24/10/2026). Le journal est écrit côté Rust (`apps/poste/src-tauri/src/journal_erreurs.rs`), qui assainit tout texte
 * (adresses, jetons, valeurs de clés sensibles, requêtes d'URL) et borne sa taille ; ce module ne fait que décrire
 * l'erreur et la lui envoyer. Il ne lance jamais d'exception et ne dépend pas de Tauri (l'envoi est injecté).
 */

export type GenreErreurJs = "erreur_js" | "promesse_rejetee";

export type ErreurJs = {
  genre: GenreErreurJs;
  message: string;
  source: string | null;
  ligne: number | null;
};

/** Appel de commande Tauri (`invoke`), injecté. */
export type EnvoiJournal = (commande: string, args: Record<string, unknown>) => Promise<unknown>;

export const COMMANDE_JOURNAL = "journaliser_erreur_js";
/** Entrées envoyées au plus par fenêtre d'une minute : une boucle d'erreurs ne doit pas saturer le canal. */
export const ENTREES_MAX_PAR_MINUTE = 20;
const LONGUEUR_MAX = 400;

function borner(texte: string): string {
  return texte.length > LONGUEUR_MAX ? `${texte.slice(0, LONGUEUR_MAX)}…` : texte;
}

function decrireValeur(valeur: unknown): string {
  if (valeur instanceof Error) {
    return borner(`${valeur.name}: ${valeur.message}`);
  }
  if (typeof valeur === "string") {
    return borner(valeur);
  }
  // Une valeur qui n'est ni une erreur ni un texte (objet, nombre…) : son type seulement, jamais son contenu.
  return `valeur non textuelle (${typeof valeur})`;
}

export type EvenementErreur = {
  message?: unknown;
  filename?: unknown;
  lineno?: unknown;
  error?: unknown;
};

export function decrireErreur(evenement: EvenementErreur): ErreurJs {
  const message =
    evenement.error instanceof Error
      ? decrireValeur(evenement.error)
      : typeof evenement.message === "string" && evenement.message !== ""
        ? borner(evenement.message)
        : "erreur sans message";
  return {
    genre: "erreur_js",
    message,
    source: typeof evenement.filename === "string" && evenement.filename !== "" ? evenement.filename : null,
    ligne: typeof evenement.lineno === "number" && Number.isFinite(evenement.lineno) ? evenement.lineno : null,
  };
}

export function decrirePromesseRejetee(raison: unknown): ErreurJs {
  return { genre: "promesse_rejetee", message: decrireValeur(raison), source: null, ligne: null };
}

type Cible = {
  addEventListener: (type: string, ecouteur: (evenement: Event) => void) => void;
  removeEventListener: (type: string, ecouteur: (evenement: Event) => void) => void;
};

/**
 * Écoute `error` et `unhandledrejection` et envoie chaque erreur au journal (au plus 20 par minute). Rend la fonction
 * qui retire les écouteurs.
 */
export function installerJournalErreurs(
  cible: Cible,
  envoyer: EnvoiJournal,
  maintenant: () => number = Date.now,
): () => void {
  let debutFenetre = maintenant();
  let envoyees = 0;
  const consigner = (erreur: ErreurJs) => {
    const present = maintenant();
    if (present - debutFenetre >= 60_000) {
      debutFenetre = present;
      envoyees = 0;
    }
    if (envoyees >= ENTREES_MAX_PAR_MINUTE) return;
    envoyees += 1;
    try {
      // Fire-and-forget : une erreur du journal ne doit jamais en provoquer une autre.
      void envoyer(COMMANDE_JOURNAL, { ...erreur }).catch(() => undefined);
    } catch {
      /* envoi impossible (hors Tauri) : rien à faire */
    }
  };
  const surErreur = (evenement: Event) => {
    consigner(decrireErreur(evenement as unknown as EvenementErreur));
  };
  const surRejet = (evenement: Event) => {
    consigner(decrirePromesseRejetee((evenement as unknown as { reason?: unknown }).reason));
  };
  cible.addEventListener("error", surErreur);
  cible.addEventListener("unhandledrejection", surRejet);
  return () => {
    cible.removeEventListener("error", surErreur);
    cible.removeEventListener("unhandledrejection", surRejet);
  };
}
