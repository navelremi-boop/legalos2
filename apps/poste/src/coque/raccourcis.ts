/** Raccourcis clavier du poste, déclarés en un seul endroit (affichage et attributs d'accessibilité). */
export const RACCOURCIS = {
  saisirTemps: { touche: "T", aria: "T" },
  palette: { touche: "Ctrl K", aria: "Control+K" },
} as const;

/** Valeur d'aria-keyshortcuts pour une touche affichée (« T », « Ctrl K »). */
export function ariaRaccourci(touche: string): string {
  return touche.replace(/^Ctrl\s+/u, "Control+");
}
