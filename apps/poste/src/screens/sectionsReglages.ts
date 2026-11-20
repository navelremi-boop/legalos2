/**
 * Sections de l'écran Réglages (maquette prototype-reglages).
 * Une section dont la fonction n'existe pas encore n'est pas affichée.
 */
export type SectionReglages = {
  id: string;
  titre: string;
  disponible: boolean;
  /** Réservée aux administrateurs : masquée quand le rôle de l'utilisateur est connu et n'est pas administrateur. */
  administrateurs?: boolean;
};

export const SECTIONS_REGLAGES: readonly SectionReglages[] = [
  { id: "cabinet", titre: "Cabinet", disponible: true },
  { id: "collaborateurs", titre: "Collaborateurs et droits", disponible: false },
  { id: "utilisateurs", titre: "Utilisateurs", disponible: true, administrateurs: true },
  { id: "messagerie", titre: "Messagerie", disponible: true },
  { id: "modeles", titre: "Modèles de documents", disponible: true },
  { id: "qualites", titre: "Qualités", disponible: true },
  { id: "taux", titre: "Taux et facturation", disponible: false },
  { id: "postes", titre: "Postes et sécurité", disponible: false },
  { id: "apparence", titre: "Apparence", disponible: true },
  { id: "reference", titre: "Référence des dossiers", disponible: true },
];

/**
 * Sections affichées. `administrateur` : `true` ou `false` quand le rôle est connu, `null` tant qu'il ne l'est pas
 * (hors ligne, avant la première lecture) ; seul un rôle connu et différent d'administrateur masque une section réservée.
 */
export function sectionsVisibles(administrateur: boolean | null = null): SectionReglages[] {
  return SECTIONS_REGLAGES.filter(
    (section) => section.disponible && !(section.administrateurs === true && administrateur === false),
  );
}
