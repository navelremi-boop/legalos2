import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { appeler, type ResultatApi } from "@/messagerie/appelApi";
import type { RequeteApi } from "@/messagerie/formesApiRedaction";
import {
  adresseAutorisationOuvrable,
  lireDebut,
  lireEchange,
  lireFournisseurs,
  lireRetourBouclage,
  messageEchecAppel,
  MESSAGE_ANNULE,
  redirectionBouclage,
  requeteDebut,
  requeteEchange,
  requeteFournisseurs,
  validerRetour,
  type EtapeOAuth,
  type FournisseurOAuth,
  type PhaseAppelOAuth,
} from "@/messagerie/formesOAuth";
import {
  confierAdresseALaRecette,
  fournisseursDeRecette,
  recetteAutoriseHttp,
  supplementDeRecette,
} from "@/messagerie/oauthRecette";

/**
 * Connexion d'une boîte par OAuth : écoute locale (commandes Tauri `oauth_*`), appels à l'instance, navigateur du
 * système. En ligne seulement. Le poste ne voit ni ne garde aucun jeton : le code d'autorisation, rendu par le
 * navigateur à l'écoute locale, part à l'instance et n'est conservé nulle part (ni stockage, ni journal).
 */

export type DemandeConnexionOAuth = { compteId: string; adresse: string; fournisseur: string };

export type ResultatConnexionOAuth =
  | { ok: true; compteId: string; reconnexion: boolean }
  | { ok: false; annule: boolean; message: string };

export type ParcoursOAuth = {
  /** Ferme l'écoute locale et libère l'attente ; sans effet une fois l'échange commencé. */
  annuler: () => void;
  resultat: Promise<ResultatConnexionOAuth>;
};

/** Fournisseurs que l'instance sait connecter (liste vide si elle n'en propose pas ; l'appelant gère l'erreur). */
export async function lireFournisseursOAuth(instanceUrl: string): Promise<ResultatApi<FournisseurOAuth[]>> {
  const requete = requeteFournisseurs();
  const resultat = await appeler(instanceUrl, requete.methode, requete.chemin, {
    delaiMs: 12_000,
    lire: lireFournisseurs,
  });
  const deRecette = fournisseursDeRecette();
  if (!resultat.ok || deRecette.length === 0) return resultat;
  return { ok: true, valeur: [...resultat.valeur, ...deRecette] };
}

function envoyer<T>(instanceUrl: string, requete: RequeteApi, lire: (json: unknown) => T): Promise<ResultatApi<T>> {
  return appeler(instanceUrl, requete.methode, requete.chemin, {
    corps: JSON.stringify(requete.corps ?? {}),
    typeContenu: "application/json",
    delaiMs: 20_000,
    lire,
  });
}

function echec(phase: PhaseAppelOAuth, statut: number, message: string): ResultatConnexionOAuth {
  return { ok: false, annule: false, message: messageEchecAppel(phase, statut, message) };
}

const annulee: ResultatConnexionOAuth = { ok: false, annule: true, message: MESSAGE_ANNULE };

let parcoursEnCours = false;

/** Ferme l'écoute locale ; jamais d'erreur (elle peut déjà être fermée). */
async function fermerEcoute(id: string): Promise<void> {
  try {
    await invoke("oauth_annuler_bouclage", { id });
  } catch {
    /* déjà fermée */
  }
}

async function ouvrirDansLeNavigateur(adresse: string): Promise<boolean> {
  if (!adresseAutorisationOuvrable(adresse, recetteAutoriseHttp())) return false;
  try {
    if (!confierAdresseALaRecette(adresse)) await openUrl(adresse);
    return true;
  } catch {
    return false;
  }
}

type EtatParcours = { annule: boolean; ecoute: string | null };

async function parcourir(
  instanceUrl: string,
  demande: DemandeConnexionOAuth,
  surEtape: (etape: EtapeOAuth) => void,
  etat: EtatParcours,
): Promise<ResultatConnexionOAuth> {
  // Relu à chaque fois : l'annulation survient pendant les attentes.
  const estAnnule = (): boolean => etat.annule;
  surEtape("ouverture");
  let ecoute: { id: string; port: number };
  try {
    ecoute = await invoke<{ id: string; port: number }>("oauth_ecouter_bouclage");
  } catch (erreur) {
    return {
      ok: false,
      annule: false,
      message: typeof erreur === "string" && erreur !== "" ? erreur : "Impossible d'ouvrir le port local de connexion.",
    };
  }
  etat.ecoute = ecoute.id;
  if (estAnnule()) return annulee;
  const redirection = redirectionBouclage(ecoute.port);
  if (redirection === null) return { ok: false, annule: false, message: "Le port local de connexion est inattendu." };

  const supplement = supplementDeRecette(demande.fournisseur);
  const debut = await envoyer(
    instanceUrl,
    requeteDebut({
      id: demande.compteId,
      adresse: demande.adresse,
      fournisseur: demande.fournisseur,
      redirection,
      ...(supplement === undefined ? {} : { supplement }),
    }),
    lireDebut,
  );
  if (!debut.ok) return echec("debut", debut.statut, debut.message);
  if (debut.valeur === null) return { ok: false, annule: false, message: "La réponse de l'instance est inattendue." };
  if (estAnnule()) return annulee;
  const { state, url } = debut.valeur;

  if (!(await ouvrirDansLeNavigateur(url))) {
    return { ok: false, annule: false, message: "Impossible d'ouvrir le navigateur du système." };
  }
  if (estAnnule()) return annulee;

  surEtape("attente");
  let brut: unknown;
  try {
    brut = await invoke<unknown>("oauth_attendre_retour", { id: ecoute.id });
  } catch {
    return estAnnule()
      ? annulee
      : { ok: false, annule: false, message: "L'attente de la connexion a été interrompue." };
  }
  const verdict = validerRetour(lireRetourBouclage(brut), state);
  if (!verdict.ok) return verdict;

  surEtape("echange");
  const echange = await envoyer(instanceUrl, requeteEchange(verdict.state, verdict.code), lireEchange);
  if (!echange.ok) return echec("echange", echange.statut, echange.message);
  if (echange.valeur === null) return { ok: false, annule: false, message: "La réponse de l'instance est inattendue." };
  return { ok: true, compteId: echange.valeur.id, reconnexion: echange.valeur.reconnexion };
}

/**
 * Lance le parcours : écoute locale, début chez l'instance, navigateur du système, attente du retour, échange.
 * Un seul parcours à la fois ; `surEtape` est appelé à chaque étape. Le résultat ne rejette jamais.
 */
export function lancerConnexionOAuth(
  instanceUrl: string,
  demande: DemandeConnexionOAuth,
  surEtape: (etape: EtapeOAuth) => void,
): ParcoursOAuth {
  if (parcoursEnCours) {
    return {
      annuler: () => undefined,
      resultat: Promise.resolve({ ok: false, annule: false, message: "Une connexion est déjà en cours." }),
    };
  }
  parcoursEnCours = true;
  const etat: EtatParcours = { annule: false, ecoute: null };
  let derniereEtape: EtapeOAuth = "ouverture";
  const resultat = parcourir(
    instanceUrl,
    demande,
    (etape) => {
      derniereEtape = etape;
      surEtape(etape);
    },
    etat,
  )
    .catch((): ResultatConnexionOAuth => ({ ok: false, annule: false, message: "La connexion a échoué. Réessayez." }))
    .finally(() => {
      parcoursEnCours = false;
      if (etat.ecoute !== null) void fermerEcoute(etat.ecoute);
    });
  return {
    annuler: () => {
      // Une fois le code remis à l'instance, l'échange va jusqu'au bout.
      if (derniereEtape === "echange") return;
      etat.annule = true;
      if (etat.ecoute !== null) void fermerEcoute(etat.ecoute);
    },
    resultat,
  };
}
