import type { ChemiseId } from "@/lib/chemise";

export type LigneAssemblee = {
  id: string;
  titre: string;
  meta: string;
  dossier?: { nom: string; chemise: ChemiseId };
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
};

export type TempsSource = {
  id: string;
  libelle: string;
  minutes: number;
  origine: "mail" | "agenda";
  dossierNom?: string;
  chemise?: ChemiseId;
};

/** « 9 h 30 », heure sans zéro de tête. */
export function libelleHeure(heure: number, minute: number): string {
  return `${String(heure)} h ${String(minute).padStart(2, "0")}`;
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

function dossier(nom?: string, chemise?: ChemiseId): LigneAssemblee["dossier"] {
  if (!nom || !chemise) return undefined;
  return { nom, chemise };
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
    dossier: dossier(source.dossierNom, source.chemise),
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
    dossier: dossier(source.dossierNom, source.chemise),
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
    dossier: dossier(source.dossierNom, source.chemise),
    saisir: { minutes: source.minutes },
  };
}
