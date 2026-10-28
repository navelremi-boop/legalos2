/**
 * Repères de l'écran Agenda : jours civils (AAAA-MM-JJ) et semaines commençant le lundi. Calcul sur le calendrier
 * civil, sans fuseau : un jour décalé reste le même jour à Paris comme ailleurs.
 */

/** Jour civil d'une date, d'après l'heure locale de la machine. */
export function jourCivil(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${mois}-${jour}`;
}

function enUtc(jour: string): Date {
  const [annee, mois, quantieme] = jour.split("-").map(Number);
  return new Date(Date.UTC(annee ?? 1970, (mois ?? 1) - 1, quantieme ?? 1));
}

function versJour(date: Date): string {
  const mois = String(date.getUTCMonth() + 1).padStart(2, "0");
  const quantieme = String(date.getUTCDate()).padStart(2, "0");
  return `${String(date.getUTCFullYear())}-${mois}-${quantieme}`;
}

/** Le jour décalé de `n` jours (négatif : avant). */
export function decalerJour(jour: string, n: number): string {
  const date = enUtc(jour);
  date.setUTCDate(date.getUTCDate() + n);
  return versJour(date);
}

/**
 * Lundi à vendredi, plus le samedi ou le dimanche s'il porte déjà un élément.
 * `semaine` va du lundi au dimanche.
 */
export function joursSemaineAffiches(semaine: readonly string[], joursOccupes: ReadonlySet<string>): string[] {
  return [...semaine.slice(0, 5), ...semaine.slice(5).filter((jour) => joursOccupes.has(jour))];
}

/** Les sept jours de la semaine (lundi au dimanche) qui contient `jour`. */
export function semaineDe(jour: string): string[] {
  const decalage = (enUtc(jour).getUTCDay() + 6) % 7;
  const lundi = decalerJour(jour, -decalage);
  return Array.from({ length: 7 }, (_, index) => decalerJour(lundi, index));
}

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

/** « octobre 2026 », à passer par `fr()` à l'affichage. */
export function libelleMois(jour: string): string {
  const [annee, mois] = jour.split("-");
  const nom = MOIS[(Number(mois) || 1) - 1] ?? "";
  return `${nom} ${annee ?? ""}`;
}

/** Premier jour du mois de `jour`. */
export function debutMois(jour: string): string {
  return `${jour.slice(0, 7)}-01`;
}

/** Initiales des jours, lundi en tête, pour le mini-calendrier. */
export const INITIALES_JOURS = ["L", "M", "M", "J", "V", "S", "D"] as const;

/** Grille du mois, du lundi au dimanche, y compris les jours des mois voisins. */
export function grilleMois(jour: string): { jour: string; dansMois: boolean }[] {
  const premier = debutMois(jour);
  const mois = premier.slice(0, 7);
  const suivant = decalerJour(premier, 32).slice(0, 7);
  const dernier = decalerJour(`${suivant}-01`, -1);
  const debut = semaineDe(premier)[0] ?? premier;
  const fin = semaineDe(dernier)[6] ?? dernier;
  const cases: { jour: string; dansMois: boolean }[] = [];
  for (let curseur = debut; curseur <= fin; curseur = decalerJour(curseur, 1)) {
    cases.push({ jour: curseur, dansMois: curseur.slice(0, 7) === mois });
    if (cases.length > 42) break;
  }
  return cases;
}
