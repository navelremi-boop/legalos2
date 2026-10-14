import { useCallback, useRef, useState } from "react";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import { stockageNavigateur } from "@/messagerie/cacheRedaction";
import {
  ecrireJournal,
  lireJournal,
  noterActe,
  noterRegle,
  type JournalMails,
} from "@/messagerie/journalMails";
import type { ActeMail } from "@/messagerie/tempsMail";

/** Journal local des suites données aux mails (réponse, transfert, temps saisi), relu une fois puis tenu à jour. */
export function useJournalMails(): {
  journal: JournalMails | null;
  noterActeMail: (messageId: string, acte: ActeMail) => void;
  noterReglement: (messageId: string) => void;
} {
  const [journal, setJournal] = useState<JournalMails | null>(() =>
    lireJournal(stockageNavigateur(), utilisateurIdDepuisJeton(loadSessionTokens().accessToken)),
  );
  const courant = useRef(journal);

  const appliquer = useCallback((changer: (precedent: JournalMails) => JournalMails) => {
    if (courant.current === null) return;
    const suivant = changer(courant.current);
    courant.current = suivant;
    ecrireJournal(stockageNavigateur(), suivant);
    setJournal(suivant);
  }, []);

  const noterActeMail = useCallback(
    (messageId: string, acte: ActeMail) => {
      appliquer((precedent) => noterActe(precedent, messageId, acte));
    },
    [appliquer],
  );
  const noterReglement = useCallback(
    (messageId: string) => {
      appliquer((precedent) => noterRegle(precedent, messageId));
    },
    [appliquer],
  );
  return { journal, noterActeMail, noterReglement };
}
