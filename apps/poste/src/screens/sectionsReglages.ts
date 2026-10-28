/**
 * Sections de l'écran Réglages (maquette prototype-reglages).
 * Une section dont la fonction n'existe pas encore n'est pas affichée.
 */
export type SectionReglages = {
  id: string;
  titre: string;
  disponible: boolean;
};

export const SECTIONS_REGLAGES: readonly SectionReglages[] = [
  { id: "cabinet", titre: "Cabinet", disponible: true },
  { id: "collaborateurs", titre: "Collaborateurs et droits", disponible: false },
  { id: "messagerie", titre: "Messagerie", disponible: true },
  { id: "modeles", titre: "Modèles de documents", disponible: true },
  { id: "taux", titre: "Taux et facturation", disponible: false },
  { id: "postes", titre: "Postes et sécurité", disponible: false },
  { id: "apparence", titre: "Apparence", disponible: true },
  { id: "reference", titre: "Référence des dossiers", disponible: true },
];

export function sectionsVisibles(): SectionReglages[] {
  return SECTIONS_REGLAGES.filter((section) => section.disponible);
}
