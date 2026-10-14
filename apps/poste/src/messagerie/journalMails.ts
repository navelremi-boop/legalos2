import type { StockageTexte } from "@/messagerie/cacheRedaction";
import type { ActeMail } from "@/messagerie/tempsMail";

/**
 * Ce que l'utilisateur a fait de chaque mail sur ce poste : réponse envoyée, transfert envoyé, temps saisi ou proposition
 * écartée. Il alimente la suggestion de temps. C'est un repère local, pas une donnée du cabinet : il n'est ni synchronisé
 * ni jamais lu pour un autre utilisateur. Seuls des identifiants techniques y figurent.
 */

export type SuiteMail = { actes: ActeMail[]; regle: boolean };

export type JournalMails = {
  utilisateurId: string;
  /** Suites par identifiant de message (identifiant technique de la base). */
  mails: Record<string, SuiteMail>;
};

export const CLE_JOURNAL_MAILS = "legalos.mails.suites.v1";

/** Nombre de mails dont le journal garde la trace : les plus anciens sortent d'abord. */
export const MAILS_GARDES_MAX = 2_000;

const ACTES: readonly ActeMail[] = ["reponse", "transfert"];

export function journalVide(utilisateurId: string): JournalMails {
  return { utilisateurId, mails: {} };
}

export function suiteDuMail(journal: JournalMails, messageId: string): SuiteMail {
  return journal.mails[messageId] ?? { actes: [], regle: false };
}

function avecSuite(journal: JournalMails, messageId: string, suite: SuiteMail): JournalMails {
  // La suite modifiée repasse en dernier : c'est elle qui reste quand le journal est plein.
  const autres = Object.entries(journal.mails).filter(([cle]) => cle !== messageId);
  const gardees = autres.slice(Math.max(0, autres.length - (MAILS_GARDES_MAX - 1)));
  return { ...journal, mails: Object.fromEntries([...gardees, [messageId, suite]]) };
}

/** Note qu'un mail a été traité (réponse ou transfert envoyé). Une proposition déjà réglée redevient possible : il y a du nouveau. */
export function noterActe(journal: JournalMails, messageId: string, acte: ActeMail): JournalMails {
  const suite = suiteDuMail(journal, messageId);
  const actes = suite.actes.includes(acte) ? suite.actes : [...suite.actes, acte];
  return avecSuite(journal, messageId, { actes, regle: false });
}

/** Note que le temps du mail est saisi, ou que la proposition est écartée. */
export function noterRegle(journal: JournalMails, messageId: string): JournalMails {
  return avecSuite(journal, messageId, { ...suiteDuMail(journal, messageId), regle: true });
}

export function lireJournalDepuisTexte(texte: string | null, utilisateurId: string): JournalMails {
  if (texte === null) return journalVide(utilisateurId);
  try {
    const brut = JSON.parse(texte) as unknown;
    if (typeof brut !== "object" || brut === null) return journalVide(utilisateurId);
    const ligne = brut as Record<string, unknown>;
    if (ligne.utilisateurId !== utilisateurId) return journalVide(utilisateurId);
    const mails: Record<string, SuiteMail> = {};
    if (typeof ligne.mails === "object" && ligne.mails !== null) {
      for (const [id, valeur] of Object.entries(ligne.mails as Record<string, unknown>)) {
        if (typeof valeur !== "object" || valeur === null) continue;
        const suite = valeur as Record<string, unknown>;
        const actes = Array.isArray(suite.actes)
          ? ACTES.filter((acte) => (suite.actes as unknown[]).includes(acte))
          : [];
        mails[id] = { actes, regle: suite.regle === true };
      }
    }
    return { utilisateurId, mails };
  } catch {
    return journalVide(utilisateurId);
  }
}

export function lireJournal(stockage: StockageTexte | null, utilisateurId: string | null): JournalMails | null {
  if (utilisateurId === null) return null;
  try {
    return lireJournalDepuisTexte(stockage === null ? null : stockage.getItem(CLE_JOURNAL_MAILS), utilisateurId);
  } catch {
    return journalVide(utilisateurId);
  }
}

/** Écrit le journal ; sans stockage, la suite se perd à la fermeture mais l'écran fonctionne. */
export function ecrireJournal(stockage: StockageTexte | null, journal: JournalMails): void {
  if (stockage === null) return;
  try {
    stockage.setItem(CLE_JOURNAL_MAILS, JSON.stringify(journal));
  } catch {
    /* stockage plein ou refusé */
  }
}
