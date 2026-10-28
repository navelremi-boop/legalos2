import { joursEntre } from "@/dossiers/listeDossiers";
import type { ChemiseId } from "@/lib/chemise";
import { formatDateCourte, formatDuree } from "@/lib/format";

export type LigneAssemblee = {
  id: string;
  titre: string;
  meta: string;
  dossier?: { nom: string; chemise: ChemiseId; reference?: string | null };
  calcule?: boolean;
  classer?: { messageId: string; dossierId: string };
  /** Extrait du message, seulement s'il est renseigné. */
  extrait?: string;
  saisir?: { minutes: number };
  /** Heure murale, « 9 h 30 ». */
  heure?: string;
  /** Jours civils restants. 0 = aujourd'hui. */
  jours?: number;
  tache?: boolean;
};

export type DelaiSource = {
  id: string;
  titre: string;
  origineCalcul: string | null;
  dossierNom?: string;
  chemise?: ChemiseId;
  reference?: string | null;
  jours?: number | null;
  dateLibelle?: string;
};

export type MailSource = {
  id: string;
  objet: string;
  expediteur: string;
  suggestionDossierId: string | null;
  extrait?: string | null;
  dossierNom?: string;
  chemise?: ChemiseId;
  reference?: string | null;
};

export type TempsSource = {
  id: string;
  libelle: string;
  minutes: number;
  origine: "mail" | "agenda";
  dossierNom?: string;
  chemise?: ChemiseId;
  reference?: string | null;
};

/** « 9 h 30 », heure sans zéro de tête. */
export function libelleHeure(heure: number, minute: number): string {
  return `${String(heure)} h ${String(minute).padStart(2, "0")}`;
}

/** Minutes murales d'un libellé « 9 h 30 ». */
export function minutesDepuisLibelle(heure: string): number | null {
  const lu = /^(\d{1,2}) h (\d{2})$/.exec(heure);
  const heures = lu?.[1];
  const minutes = lu?.[2];
  if (heures === undefined || minutes === undefined) return null;
  return Number(heures) * 60 + Number(minutes);
}

/** Pastille de l'en-tête : le prochain rendez-vous encore devant, sinon la fin de journée. */
export function libelleProchainRendezVous(maintenantMinutes: number, heures: readonly number[]): string {
  const prochain = [...heures].filter((minute) => minute >= maintenantMinutes).sort((a, b) => a - b)[0];
  if (prochain === undefined) return "Plus de rendez-vous aujourd'hui";
  const ecart = prochain - maintenantMinutes;
  return `Prochain rendez-vous dans ${formatDuree(ecart * 60)}`;
}

/**
 * Date affichée et nombre de jours d'un même délai. Les deux viennent de la date civile,
 * donc un libellé ne peut pas contredire le compte à rebours (changement de mois, changement d'heure).
 */
export function delaiAffiche(
  jourPage: string,
  dateEcheance: string,
): { jours: number; libelle: string } | null {
  const jours = joursEntre(jourPage, dateEcheance);
  const courte = formatDateCourte(dateEcheance);
  if (jours === null || courte === "") return null;
  return { jours, libelle: `échéance le ${courte}` };
}

/** Écart affiché à droite d'un délai. */
export function libelleEcart(jours: number): string {
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "dans 1 jour";
  return `dans ${String(jours)} jours`;
}

/**
 * Part du cercle dessinée : plus le délai est proche, plus l'arc est plein.
 * Plancher 0,1 pour qu'un délai lointain reste visible.
 */
export function partAnneau(jours: number): number {
  return Math.max(0.1, Math.min(1, 1 - jours / 60));
}

function dossier(nom?: string, chemise?: ChemiseId, reference?: string | null): LigneAssemblee["dossier"] {
  if (!nom || !chemise) return undefined;
  return { nom, chemise, reference };
}

/** Un délai du moteur porte la mention « Calculé ». L'écart en jours alimente l'anneau. */
export function ligneDelai(source: DelaiSource): LigneAssemblee {
  const jours = source.jours === null || source.jours === undefined || source.jours < 0 ? undefined : source.jours;
  return {
    id: source.id,
    titre: source.titre,
    meta: source.dateLibelle ?? "",
    calcule: Boolean(source.origineCalcul),
    jours,
    dossier: dossier(source.dossierNom, source.chemise, source.reference),
  };
}

/** Classement en un clic seulement quand une suggestion de dossier existe. */
export function ligneMail(source: MailSource): LigneAssemblee {
  const extrait = source.extrait?.trim() ?? "";
  return {
    id: source.id,
    titre: source.objet,
    meta: source.expediteur,
    extrait: extrait === "" ? undefined : extrait,
    dossier: dossier(source.dossierNom, source.chemise, source.reference),
    classer:
      source.suggestionDossierId && source.suggestionDossierId !== ""
        ? { messageId: source.id, dossierId: source.suggestionDossierId }
        : undefined,
  };
}

export function ligneTemps(source: TempsSource): LigneAssemblee {
  return {
    id: source.id,
    titre: source.libelle,
    meta: source.origine === "mail" ? "Relevé sur vos mails" : "Relevé sur votre agenda",
    dossier: dossier(source.dossierNom, source.chemise, source.reference),
    saisir: { minutes: source.minutes },
  };
}
