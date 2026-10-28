import { htTempsCentimes, TAUX_PAR_DEFAUT_CENTIMES } from "@/facturation/ecrireTemps";
import type { ChemiseId } from "@/lib/chemise";

export type LigneJournee = {
  id: string;
  titre: string;
  meta: string;
  dossier?: { nom: string; chemise: ChemiseId; reference?: string | null };
  urgent?: boolean;
  calcule?: boolean;
  classer?: { messageId: string; dossierId: string };
  extrait?: string;
  saisir?: { minutes: number };
  heure?: string;
  jours?: number;
  tache?: boolean;
};

export type DonneesJournee = {
  audiences: LigneJournee[];
  delais: LigneJournee[];
  mails: LigneJournee[];
  temps: LigneJournee[];
  nonFacture: { minutes: number; htCentimes: number };
};

/** Jeu fictif pour DEV / galerie / captures B9 (§ 7.6). */
export const JOURNEE_DEMO: DonneesJournee = {
  audiences: [
    {
      id: "aud-1",
      titre: "Audience de mise en état",
      meta: "TJ Nanterre",
      heure: "9 h 30",
      dossier: { nom: "Ferrand Métal", chemise: "kraft", reference: "2026-042" },
    },
    {
      id: "aud-2",
      titre: "Rendez-vous client",
      meta: "Cabinet",
      heure: "14 h 00",
      dossier: { nom: "SCI des Lilas", chemise: "vert-amande", reference: "2026-038" },
    },
    {
      id: "tache-1",
      titre: "Relire le projet d'assignation",
      meta: "À faire aujourd'hui",
      tache: true,
      dossier: { nom: "Ferrand Métal", chemise: "kraft", reference: "2026-042" },
    },
  ],
  delais: [
    {
      id: "del-1",
      titre: "Conclusions adverses",
      meta: "",
      jours: 5,
      calcule: true,
      dossier: { nom: "Ferrand Métal", chemise: "kraft", reference: "2026-042" },
      urgent: false,
    },
    {
      id: "del-2",
      titre: "Appel incident",
      meta: "échéance le 29 sept.",
      jours: 2,
      dossier: { nom: "Martin / Assurances Loire", chemise: "bleu-classeur", reference: "2026-031" },
      urgent: true,
    },
  ],
  mails: [
    {
      id: "mail-1",
      titre: "Me Dupont — pièces jointes",
      meta: "Suggéré : Ferrand Métal",
      extrait: "Les pièces 12 et 13 sont jointes.",
      dossier: { nom: "Ferrand Métal", chemise: "kraft", reference: "2026-042" },
      classer: { messageId: "mail-1", dossierId: "ferrand" },
    },
    {
      id: "mail-2",
      titre: "Assurances Loire — mise en demeure",
      meta: "Suggéré : Martin / Assurances Loire",
      dossier: { nom: "Martin / Assurances Loire", chemise: "bleu-classeur", reference: "2026-031" },
      classer: { messageId: "mail-2", dossierId: "martin" },
    },
  ],
  temps: [
    {
      id: "tps-1",
      titre: "Préparation audience",
      meta: "Relevé sur vos mails",
      saisir: { minutes: 45 },
      dossier: { nom: "Ferrand Métal", chemise: "kraft", reference: "2026-042" },
    },
    {
      id: "tps-2",
      titre: "Entretien téléphonique",
      meta: "Relevé sur votre agenda",
      saisir: { minutes: 20 },
      dossier: { nom: "SCI des Lilas", chemise: "vert-amande", reference: "2026-038" },
    },
  ],
  nonFacture: { minutes: 90, htCentimes: htTempsCentimes(90, TAUX_PAR_DEFAUT_CENTIMES) },
};
