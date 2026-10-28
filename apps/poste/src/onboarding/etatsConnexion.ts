/** Les onze états de la maquette de connexion. */
export const ETATS_CONNEXION = [
  "adresse",
  "chiffrement",
  "connexion",
  "mdp",
  "otp",
  "otpe",
  "sync",
  "verrou",
  "horsligne",
  "revoque",
  "trousseau",
] as const;

export type EtatConnexion = (typeof ETATS_CONNEXION)[number];

export const SITUATIONS_CONNEXION = ["verrou", "horsligne", "revoque", "trousseau"] as const;

export type ContenuConnexion = {
  titre: string;
  sousTitre: string;
  alerte?: { titre: string; texte: string };
  info?: { titre: string; texte: string };
  bouton: string;
  /** Le lien « code de secours » sur la double authentification. */
  lienSecours: boolean;
  /** Afficher l'état n'efface pas la base locale. */
  effaceDonneesLocales: false;
};

const GARDES: ContenuConnexion["effaceDonneesLocales"] = false;

function secours(etat: EtatConnexion): boolean {
  return etat === "otp" || etat === "otpe";
}

export function contenuConnexion(etat: EtatConnexion): ContenuConnexion {
  switch (etat) {
    case "adresse":
      return {
        titre: "Connecter cette application à votre cabinet",
        sousTitre: "Saisissez l'adresse du serveur de votre cabinet. Votre administrateur vous l'a communiquée.",
        bouton: "Continuer",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "chiffrement":
      return {
        titre: "Connecter cette application à votre cabinet",
        sousTitre: "Saisissez l'adresse du serveur de votre cabinet. Votre administrateur vous l'a communiquée.",
        alerte: {
          titre: "Le chiffrement du disque n'est pas détecté",
          texte: "Vous pouvez continuer. Le poste sera inscrit « chiffrement non confirmé ».",
        },
        bouton: "Continuer quand même",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "connexion":
      return {
        titre: "Connexion",
        sousTitre: "Connectez-vous avec votre compte du cabinet.",
        bouton: "Se connecter",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "mdp":
      return {
        titre: "Connexion",
        sousTitre: "Connectez-vous avec votre compte du cabinet.",
        alerte: {
          titre: "Adresse ou mot de passe incorrect",
          texte: "Vérifiez votre saisie. Après plusieurs essais, le compte est suspendu quelques minutes.",
        },
        bouton: "Se connecter",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "otp":
      return {
        titre: "Double authentification",
        sousTitre: "Saisissez le code à 6 chiffres affiché par votre application d'authentification.",
        bouton: "Vérifier",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "otpe":
      return {
        titre: "Double authentification",
        sousTitre: "Saisissez le code à 6 chiffres affiché par votre application d'authentification.",
        alerte: {
          titre: "Code incorrect ou expiré",
          texte: "Un nouveau code apparaît toutes les 30 secondes.",
        },
        bouton: "Vérifier",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "sync":
      return {
        titre: "Préparation de votre poste",
        sousTitre: "Votre poste télécharge les dossiers auxquels vous avez accès. Ensuite, tout fonctionne hors ligne.",
        bouton: "Ouvrir l'application",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "verrou":
      return {
        titre: "Reprendre votre travail",
        sousTitre: "Saisissez votre mot de passe. Vos dossiers n'ont pas bougé.",
        bouton: "Déverrouiller",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "horsligne":
      return {
        titre: "Ce poste doit se reconnecter",
        sousTitre: "Il est resté hors ligne au-delà de la limite fixée par le cabinet. Connectez-vous à Internet, puis réessayez.",
        info: {
          titre: "Vos données locales sont conservées",
          texte: "Rien n'est perdu, mais le travail hors ligne est suspendu.",
        },
        bouton: "Réessayer",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "revoque":
      return {
        titre: "Ce poste a été révoqué",
        sousTitre: "L'administrateur du cabinet a retiré l'accès de cet ordinateur.",
        info: {
          titre: "Les données locales restent en place",
          texte: "Cet écran ne les efface pas. L'effacement suit la révocation, au jalon prévu.",
        },
        bouton: "Fermer l'application",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
    case "trousseau":
      return {
        titre: "Reconnexion nécessaire",
        sousTitre: "L'accès au Trousseau n'a pas été accordé.",
        info: {
          titre: "Vos données locales n'ont pas été modifiées",
          texte: "Reconnectez-vous, puis autorisez l'accès quand le système le demande.",
        },
        bouton: "Se reconnecter",
        lienSecours: secours(etat),
        effaceDonneesLocales: GARDES,
      };
  }
}

export function choisirSituation(demande: {
  verrou: boolean;
  horsLigneTropLongtemps: boolean;
  revoque: boolean;
  trousseauRefuse: boolean;
}): EtatConnexion | null {
  if (demande.revoque) return "revoque";
  if (demande.trousseauRefuse) return "trousseau";
  if (demande.horsLigneTropLongtemps) return "horsligne";
  if (demande.verrou) return "verrou";
  return null;
}

/** Valeur lue au démarrage. Toute autre chaîne est ignorée. */
export function lireSituation(valeur: string | null): EtatConnexion | null {
  if (
    valeur === "verrou" ||
    valeur === "horsligne" ||
    valeur === "revoque" ||
    valeur === "trousseau"
  ) {
    return valeur;
  }
  return null;
}

export const LIBELLES_ETAT_CONNEXION: Record<EtatConnexion, string> = {
  adresse: "Adresse du serveur",
  chiffrement: "Chiffrement non détecté",
  connexion: "Connexion",
  mdp: "Mot de passe refusé",
  otp: "Double authentification",
  otpe: "Code refusé",
  sync: "Synchronisation initiale",
  verrou: "Application verrouillée",
  horsligne: "Hors ligne trop longtemps",
  revoque: "Poste révoqué",
  trousseau: "Accès au Trousseau refusé",
};

export const LIGNES_PREPARATION = [
  "Dossiers et contacts",
  "Agenda et échéances",
  "Pièces et documents",
  "Mails classés",
  "Temps et facturation",
] as const;

/** Cinq parts, de 0 à 100, selon la phase réelle de la synchronisation initiale. */
export function progressionPreparation(
  phase: "connexion" | "schema" | "donnees" | "termine" | "apercu",
): number[] {
  switch (phase) {
    case "connexion":
      return [30, 0, 0, 0, 0];
    case "schema":
      return [100, 40, 0, 0, 0];
    case "donnees":
      return [100, 100, 60, 0, 0];
    case "termine":
      return [100, 100, 100, 100, 100];
    case "apercu":
      return [100, 100, 62, 0, 0];
  }
}
