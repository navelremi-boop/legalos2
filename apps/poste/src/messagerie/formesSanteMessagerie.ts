import type { Recu } from "@/api/contrat";
import { libelleFournisseur } from "@/messagerie/formesOAuth";
import { muralMail } from "@/messagerie/listeMails";

/**
 * Tableau de santé des boîtes (Réglages, Messagerie) : lecture de `GET /messagerie/sante` et texte à montrer pour
 * chaque boîte. Pures : le réseau est dans `apiSanteMessagerie.ts`. Contrat : `crates/api/src/routes/boites.rs`.
 */

export type SanteCompte = {
  compteId: string;
  adresse: string;
  /** `nominatif`, `partage` ou `classement`. */
  typeCompte: string;
  /** `connecte`, `identifiants_refuses`, `indisponible` (le serveur de messagerie ne répond pas) ou `inconnu`. */
  etatConnexion: string;
  derniereReleveLe: string | null;
  /** Secondes depuis la dernière relève réussie ; `null` pour la boîte du cabinet (relevée à la demande). */
  retardSecondes: number | null;
  erreursAuthentification: number;
  derniereErreurAuthentificationLe: string | null;
  envoisEnEchec: number;
  alerte: boolean;
  motifs: string[];
  /** Boîte connectée par OAuth (Microsoft 365, Gmail) : aucun mot de passe, la reconnexion passe par le navigateur. */
  oauth: boolean;
  /** `microsoft`, `gmail`… pour une boîte OAuth ; `null` sinon. */
  fournisseur: string | null;
  /** Indexation de fond des corps (recherche sur les messages jamais ouverts) : indexés, restants, abandonnés. */
  corpsIndexes: number;
  corpsRestants: number;
  corpsAbandonnes: number;
};

export type SanteMessagerie = {
  comptes: SanteCompte[];
  envoisEnEchec: number;
  alerte: boolean;
};

function objet(json: unknown): Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur : "";
}

function nombre(valeur: unknown): number {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : 0;
}

function nombreOuNul(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

function texteOuNul(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur !== "" ? valeur : null;
}

export function requeteSante(): { methode: "GET"; chemin: string } {
  return { methode: "GET", chemin: "/messagerie/sante" };
}

export function lireSante(json: unknown): SanteMessagerie {
  const racine = objet(json) as Recu<"Sante">;
  const liste = Array.isArray(racine.comptes) ? (racine.comptes as unknown[]) : [];
  return {
    comptes: liste.flatMap((element) => {
      const ligne = objet(element) as Recu<"SanteCompte">;
      const compteId = texte(ligne.compte_id);
      if (compteId === "") return [];
      return [
        {
          compteId,
          adresse: texte(ligne.adresse),
          typeCompte: texte(ligne.type_compte),
          etatConnexion: texte(ligne.etat_connexion),
          derniereReleveLe: texteOuNul(ligne.derniere_releve_le),
          retardSecondes: nombreOuNul(ligne.retard_secondes),
          erreursAuthentification: nombre(ligne.erreurs_authentification),
          derniereErreurAuthentificationLe: texteOuNul(ligne.derniere_erreur_authentification_le),
          envoisEnEchec: nombre(ligne.envois_en_echec),
          alerte: ligne.alerte === true,
          motifs: Array.isArray(ligne.motifs) ? (ligne.motifs as unknown[]).filter((m): m is string => typeof m === "string") : [],
          oauth: ligne.oauth === true,
          fournisseur: texteOuNul(ligne.fournisseur),
          corpsIndexes: nombre(ligne.corps_indexes),
          corpsRestants: nombre(ligne.corps_restants),
          corpsAbandonnes: nombre(ligne.corps_abandonnes),
        },
      ];
    }),
    envoisEnEchec: nombre(racine.envois_en_echec),
    alerte: racine.alerte === true,
  };
}

/** « il y a 1 min », « il y a 3 h », « il y a 2 j » : la durée est arrondie vers le bas, jamais plus précise que la donnée. */
export function dureeRelative(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes));
  if (s < 60) return "à l'instant";
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `il y a ${String(minutes)} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${String(heures)} h`;
  return `il y a ${String(Math.floor(heures / 24))} j`;
}

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « le 17 oct., 8 h 12 » (heure murale de Paris) ; chaîne vide si la date est illisible. */
export function dateEtHeure(valeur: string | null): string {
  const mur = muralMail(valeur);
  if (mur === null || mur.heure === null || mur.minute === null) return "";
  const [, mois, jour] = mur.jour.split("-").map(Number);
  if (mois === undefined || jour === undefined) return "";
  const j = jour === 1 ? "1er" : String(jour);
  return `le ${j} ${MOIS_COURTS[mois - 1] ?? ""}, ${String(mur.heure)} h ${String(mur.minute).padStart(2, "0")}`;
}

export type NiveauSante = "ok" | "alerte" | "neutre";

export type PresentationSante = {
  niveau: NiveauSante;
  titre: string;
  detail: string;
  /** Vrai quand les identifiants sont à ressaisir : le bouton « Reconnecter » est mis en avant. */
  reconnecter: boolean;
  /** Nom du fournisseur d'une boîte OAuth (« Microsoft 365 »), `null` pour une boîte à mot de passe. */
  fournisseur: string | null;
};

/** En français, 0 et 1 restent au singulier : « 0 message préparé », « 1 message préparé », « 2 messages préparés ». */
function messagesPrepares(n: number): string {
  return n >= 2 ? `${String(n)} messages préparés` : `${String(n)} message préparé`;
}

/**
 * Progression de l'indexation de fond d'une boîte (critère J11 : « progression dans l'écran de santé »), `null` quand
 * rien n'a encore été indexé ni attendu. Rien n'est affirmé que la donnée ne dise : « terminée » seulement quand il ne
 * reste rien, avec les abandons dits.
 */
export function presenterIndexation(compte: Pick<SanteCompte, "corpsIndexes" | "corpsRestants" | "corpsAbandonnes">): string | null {
  const { corpsIndexes: indexes, corpsRestants: restants, corpsAbandonnes: abandonnes } = compte;
  if (indexes === 0 && restants === 0 && abandonnes === 0) return null;
  const abandons =
    abandonnes === 0
      ? ""
      : abandonnes === 1
        ? " 1 message illisible a été laissé de côté."
        : ` ${String(abandonnes)} messages illisibles ont été laissés de côté.`;
  if (restants > 0) {
    return `Recherche dans le texte des messages : ${messagesPrepares(indexes)}, ${String(restants)} à venir.${abandons}`;
  }
  return `Recherche dans le texte des messages : tous les messages sont préparés (${String(indexes)}).${abandons}`;
}

function envois(n: number): string {
  return n === 1 ? "1 envoi en échec" : `${String(n)} envois en échec`;
}

/**
 * Ce que l'écran dit d'une boîte. Priorité : identifiants refusés, relève en retard, envois en échec, puis l'état normal.
 * Rien n'est affirmé que la donnée ne dise : une boîte jamais relevée n'est pas « connectée ».
 */
export function presenterSante(compte: SanteCompte): PresentationSante {
  const nom = compte.oauth ? libelleFournisseur(compte.fournisseur) : "";
  return { ...presenterEtat(compte), fournisseur: nom === "" ? null : nom };
}

type EtatPresente = Omit<PresentationSante, "fournisseur">;

function presenterEtat(compte: SanteCompte): EtatPresente {
  const sansEnvoiEnEchec = compte.envoisEnEchec === 0;
  if (compte.motifs.includes("identifiants_refuses") || compte.etatConnexion === "identifiants_refuses") {
    const depuis = dateEtHeure(compte.derniereErreurAuthentificationLe);
    return {
      niveau: "alerte",
      titre: "Identifiants refusés",
      detail: `${depuis === "" ? "" : `Depuis ${depuis}. `}Les tentatives sont suspendues.${compte.oauth ? " L'autorisation est à renouveler." : ""}`,
      reconnecter: true,
    };
  }
  if (compte.motifs.includes("serveur_indisponible") || compte.etatConnexion === "indisponible") {
    // Une panne du serveur de messagerie ne dit rien des identifiants : jamais « refusés », rien à reconnecter.
    return {
      niveau: "alerte",
      titre: "Serveur indisponible",
      detail: `Le serveur de messagerie ne répond pas. Nouvelle tentative automatique, rien à faire de votre côté.${compte.envoisEnEchec === 0 ? "" : ` ${envois(compte.envoisEnEchec)}.`}`,
      reconnecter: false,
    };
  }
  if (compte.motifs.includes("retard")) {
    const quand = compte.retardSecondes === null ? "" : ` ${dureeRelative(compte.retardSecondes)}`;
    return {
      niveau: "alerte",
      titre: "Relève en retard",
      detail: `Dernière relève${quand === "" ? " inconnue" : quand}.${sansEnvoiEnEchec ? "" : ` ${envois(compte.envoisEnEchec)}.`}`,
      reconnecter: false,
    };
  }
  if (!sansEnvoiEnEchec) {
    return {
      niveau: "alerte",
      titre: "Envoi en échec",
      detail: `${envois(compte.envoisEnEchec)}, à relancer depuis la file d'envoi.`,
      reconnecter: false,
    };
  }
  if (compte.typeCompte === "classement") {
    return { niveau: "ok", titre: "Relevée à la demande", detail: "Boîte du cabinet, relevée quand on la demande.", reconnecter: false };
  }
  if (compte.derniereReleveLe === null || compte.etatConnexion !== "connecte") {
    return { niveau: "neutre", titre: "Connexion en cours", detail: "Pas encore relevée.", reconnecter: false };
  }
  const quand = compte.retardSecondes === null ? "" : ` ${dureeRelative(compte.retardSecondes)}`;
  return {
    niveau: "ok",
    titre: "Connectée",
    detail: `Relevée${quand === "" ? "" : quand}, aucun envoi en échec.`,
    reconnecter: false,
  };
}
