export type CategorieAgenda = "audience" | "rendez_vous" | "tache" | "echeance";

export const CATEGORIES_AGENDA: CategorieAgenda[] = ["audience", "rendez_vous", "tache", "echeance"];

/** Une échéance calculée se filtre à part, même si elle a aussi un type d'élément. */
export function categorieAgenda(typeElement: string, origineCalcul: string | null): CategorieAgenda {
  if (origineCalcul) return "echeance";
  if (typeElement === "audience" || typeElement === "rendez_vous" || typeElement === "tache") {
    return typeElement;
  }
  return "tache";
}

/** Grille horaire de la maquette : 8 h à 19 h, 48 px par heure. */
export const GRILLE_DEBUT = 8;
export const GRILLE_FIN = 19;
export const HAUTEUR_HEURE = 48;

export function positionGrille(
  debutMinute: number,
  dureeMinute: number,
): { top: number; hauteur: number } | null {
  const debut = GRILLE_DEBUT * 60;
  const fin = GRILLE_FIN * 60;
  const finElement = debutMinute + Math.max(dureeMinute, 15);
  if (debutMinute >= fin || finElement <= debut) return null;
  const top = ((debutMinute - debut) / 60) * HAUTEUR_HEURE;
  const hauteur = Math.max(24, ((finElement - debutMinute) / 60) * HAUTEUR_HEURE - 4);
  return { top, hauteur };
}

export type Creneau = {
  id: string;
  debutMinute: number;
  dureeMinute: number;
};

export type CreneauPlace = Creneau & {
  colonne: number;
  colonnes: number;
};

/**
 * Pose côte à côte les éléments dont les horaires se recouvrent.
 * Un trou entre deux groupes leur rend chacun toute la largeur.
 */
export function placerSimultanes(creneaux: readonly Creneau[]): CreneauPlace[] {
  const tries = [...creneaux].sort(
    (a, b) => a.debutMinute - b.debutMinute || a.id.localeCompare(b.id),
  );
  const resultat: CreneauPlace[] = [];
  let groupe: { item: Creneau; fin: number }[] = [];
  let finGroupe = 0;
  const vider = () => {
    const fins: number[] = [];
    const places = groupe.map((entree) => {
      let colonne = 0;
      while (fins[colonne] !== undefined && (fins[colonne] ?? 0) > entree.item.debutMinute) colonne += 1;
      fins[colonne] = entree.fin;
      return { ...entree.item, colonne };
    });
    const colonnes = fins.length;
    for (const place of places) resultat.push({ ...place, colonnes });
    groupe = [];
  };
  for (const item of tries) {
    const fin = item.debutMinute + Math.max(item.dureeMinute, 15);
    if (groupe.length > 0 && item.debutMinute >= finGroupe) {
      vider();
      finGroupe = 0;
    }
    groupe.push({ item, fin });
    finGroupe = Math.max(finGroupe, fin);
  }
  if (groupe.length > 0) vider();
  return resultat;
}

export type EcheanceProchaine = {
  id: string;
  jour: string;
  debutMinute: number;
};

/** Les prochaines dates à partir d'aujourd'hui, les plus proches d'abord. */
export function prochainesEcheances<T extends EcheanceProchaine>(
  lignes: readonly T[],
  aujourdhui: string,
  limite = 5,
): T[] {
  return [...lignes]
    .filter((ligne) => ligne.jour >= aujourdhui)
    .sort((a, b) => a.jour.localeCompare(b.jour) || a.debutMinute - b.debutMinute || a.id.localeCompare(b.id))
    .slice(0, limite);
}
