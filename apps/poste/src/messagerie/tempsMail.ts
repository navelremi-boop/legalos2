/**
 * Suggestion de temps tirée d'un mail (J11) : un mail classé dans un dossier, lu ou traité, propose des minutes à saisir
 * sur ce dossier. Fonctions pures, partagées plus tard avec l'écran Temps et La journée.
 *
 * HYPOTHÈSE PRODUIT, À VALIDER PAR L'AVOCAT (pas une règle de droit) : le barème ci-dessous est indicatif. Il est
 * modifiable ici, en un seul endroit, et couvert par `tempsMail.test.ts`. Rien n'est enregistré sans validation
 * explicite de l'utilisateur, qui peut corriger les minutes avant de les saisir.
 */

/** Minutes proposées par type de traitement. Lecture : un mail lu sans suite. Réponse : réponse ou réponse à tous. */
export const BAREME_MINUTES = {
  lecture: 6,
  reponse: 12,
  transfert: 6,
} as const;

/** Traitement d'un mail au-delà de sa lecture. */
export type ActeMail = "reponse" | "transfert";

export type PropositionTemps = {
  minutes: number;
  /** Traitements qui justifient la proposition ; `lecture` seul quand le mail n'a pas été traité. */
  motifs: ("lecture" | ActeMail)[];
  /** Libellé de la saisie de temps (sans objet ni contenu du mail). */
  libelle: string;
};

/** Plafond d'une saisie tirée d'un mail, pour qu'une faute de frappe ne devienne pas une journée facturée. */
export const MINUTES_MAX_PAR_MAIL = 480;

const LIBELLES: Record<ActeMail, string> = {
  reponse: "Réponse à un mail",
  transfert: "Transfert d'un mail",
};

/**
 * Minutes proposées pour un mail. La lecture est comprise dans tout traitement : un mail lu seulement compte la lecture ;
 * un mail traité compte chacun de ses traitements une fois (réponse, transfert), sans y ajouter la lecture.
 */
export function propositionTemps(actes: readonly ActeMail[]): PropositionTemps {
  const distincts = (["reponse", "transfert"] as const).filter((acte) => actes.includes(acte));
  if (distincts.length === 0) {
    return { minutes: BAREME_MINUTES.lecture, motifs: ["lecture"], libelle: "Lecture d'un mail" };
  }
  return {
    minutes: distincts.reduce((total, acte) => total + BAREME_MINUTES[acte], 0),
    motifs: distincts,
    libelle: distincts
      .map((acte, rang) => (rang === 0 ? LIBELLES[acte] : LIBELLES[acte].charAt(0).toLowerCase() + LIBELLES[acte].slice(1)))
      .join(" et "),
  };
}

/** Minutes saisies à la main dans la proposition : un entier de 1 à `MINUTES_MAX_PAR_MAIL` ; `null` sinon. */
export function minutesValides(saisie: string): number | null {
  const texte = saisie.trim();
  if (!/^\d{1,4}$/u.test(texte)) return null;
  const minutes = Number(texte);
  return minutes >= 1 && minutes <= MINUTES_MAX_PAR_MAIL ? minutes : null;
}

/** Intitulé du bouton de validation : « Saisir 6 min ». */
export function libelleBoutonSaisie(minutes: number): string {
  return `Saisir ${String(minutes)} min`;
}

/**
 * Une proposition n'est faite que pour un mail reçu et rangé dans un dossier, tant que l'utilisateur n'a pas saisi le temps
 * ni écarté la proposition. Un message écrit par le cabinet (envoyé, brouillon) n'en reçoit pas : le temps d'une réponse
 * se propose sur le mail auquel on répond.
 */
export function proposer(mail: { classeDansUnDossier: boolean; regle: boolean; ecritParLeCabinet: boolean }): boolean {
  return mail.classeDansUnDossier && !mail.regle && !mail.ecritParLeCabinet;
}
