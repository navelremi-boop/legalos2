import type { LigneEnvoi } from "@/messagerie/typesMails";

/**
 * File d'envoi (§ 3.8.3), cycle de vie visible dans le rail :
 * brouillon, en attente (annulable), envoyé, copie dans « Envoyés » confirmée, échec (nouvelle tentative).
 */
export type TonEnvoi = "attente" | "ok" | "echec";

export type PresentationEnvoi = {
  ton: TonEnvoi;
  /** Phrase d'état sous l'objet. */
  etat: string;
  annulable: boolean;
  relancable: boolean;
};

function versDestinataire(destinataire: string): string {
  const nom = destinataire.trim();
  return nom === "" ? "" : `, à ${nom}`;
}

export function presenterEnvoi(ligne: Pick<LigneEnvoi, "etat" | "destinataire">): PresentationEnvoi {
  const a = versDestinataire(ligne.destinataire);
  switch (ligne.etat) {
    case "brouillon":
      return { ton: "attente", etat: `Brouillon${a}`, annulable: false, relancable: false };
    case "en_attente":
      return { ton: "attente", etat: `En attente d'envoi${a}`, annulable: true, relancable: false };
    case "envoye":
      return {
        ton: "attente",
        etat: `Envoyé${a}, copie dans « Envoyés » à confirmer`,
        annulable: false,
        relancable: false,
      };
    case "copie_envoyes_confirmee":
      return { ton: "ok", etat: "Copie dans « Envoyés » confirmée", annulable: false, relancable: false };
    case "echec":
      return { ton: "echec", etat: `Échec de l'envoi${a}`, annulable: false, relancable: true };
    default:
      return { ton: "attente", etat: ligne.etat, annulable: false, relancable: false };
  }
}
