import type { ChemiseId } from "@/lib/chemise";

export type LigneAssemblee = {
  id: string;
  titre: string;
  meta: string;
  dossier?: { nom: string; chemise: ChemiseId };
  calcule?: boolean;
  classer?: { messageId: string; dossierId: string };
  saisir?: { minutes: number };
};

export type DelaiSource = {
  id: string;
  titre: string;
  origineCalcul: string | null;
  dossierNom?: string;
  chemise?: ChemiseId;
};

export type MailSource = {
  id: string;
  objet: string;
  expediteur: string;
  suggestionDossierId: string | null;
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

function dossier(nom?: string, chemise?: ChemiseId): LigneAssemblee["dossier"] {
  if (!nom || !chemise) return undefined;
  return { nom, chemise };
}

/** Un délai du moteur porte la mention « Calculé ». */
export function ligneDelai(source: DelaiSource): LigneAssemblee {
  return {
    id: source.id,
    titre: source.titre,
    meta: source.origineCalcul ? "Calculé" : "",
    calcule: Boolean(source.origineCalcul),
    dossier: dossier(source.dossierNom, source.chemise),
  };
}

/** Classement en un clic seulement quand une suggestion de dossier existe. */
export function ligneMail(source: MailSource): LigneAssemblee {
  return {
    id: source.id,
    titre: source.objet,
    meta: source.expediteur,
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
