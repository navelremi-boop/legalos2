/**
 * Écran à montrer. Un poste qui a déjà des données locales ouvre la coque tout de suite :
 * l'état du seau PowerSync (historique compacté ou non) ne le retient pas. La synchronisation
 * initiale n'apparaît que lorsqu'aucune donnée locale n'est encore là.
 */

export type EcranPoste = "attente" | "coque" | "coque-et-connexion" | "connexion" | "sync-initiale";

export function ecranDuPoste(etat: {
  ecranPret: boolean;
  authenticated: boolean;
  localReady: boolean;
  forceLogin: boolean;
  syncDone: boolean;
  aUnJeton: boolean;
}): EcranPoste {
  if (!etat.ecranPret) return "attente";
  if (!etat.authenticated && etat.localReady && !etat.forceLogin) return "coque";
  if (!etat.authenticated && etat.localReady && etat.forceLogin) return "coque-et-connexion";
  if (!etat.authenticated) return "connexion";
  if (etat.localReady) return "coque";
  if (!etat.syncDone && etat.aUnJeton) return "sync-initiale";
  return "coque";
}
