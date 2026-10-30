/** Densité des listes (docs/design.md) : préférence d'affichage propre au poste, sans effet sur les données. */
export type Densite = "confortable" | "compacte";

const CLE = "legal-os.densite";

export function lireDensite(): Densite {
  try {
    return window.localStorage.getItem(CLE) === "compacte" ? "compacte" : "confortable";
  } catch {
    return "confortable";
  }
}

export function appliquerDensite(densite: Densite): void {
  document.documentElement.dataset.densite = densite;
}

export function choisirDensite(densite: Densite): void {
  appliquerDensite(densite);
  try {
    window.localStorage.setItem(CLE, densite);
  } catch {
    /* stockage indisponible : la densité vaut pour la session */
  }
}
