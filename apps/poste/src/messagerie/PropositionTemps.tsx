import { useState } from "react";
import { IconCheck, IconClock } from "@tabler/icons-react";
import { fr } from "@/lib/fr";
import { libelleBoutonSaisie, minutesValides, type PropositionTemps as Proposition } from "@/messagerie/tempsMail";

type PropositionTempsProps = {
  proposition: Proposition;
  /** Dossier où le mail est classé, avec la couleur de sa chemise. */
  dossier: { nom: string; chemise: string };
  /** Saisie en cours d'enregistrement. */
  enCours: boolean;
  erreur: string | null;
  onSaisir: (minutes: number) => void;
  onEcarter: () => void;
};

/**
 * Temps proposé pour un mail classé dans un dossier (lu, répondu ou transféré). Rien n'est enregistré avant le clic sur
 * « Saisir » ; les minutes se corrigent avant. « Pas maintenant » écarte la proposition pour ce mail.
 */
export function PropositionTemps({ proposition, dossier, enCours, erreur, onSaisir, onEcarter }: PropositionTempsProps) {
  const [saisie, setSaisie] = useState(String(proposition.minutes));
  const minutes = minutesValides(saisie);

  return (
    <div className="mails-encart" data-testid="proposition-temps" data-chemise={dossier.chemise} data-minutes={proposition.minutes}>
      <IconClock stroke={1.6} aria-hidden />
      <div className="mails-encart__corps">
        <b>{fr(`Saisir du temps sur ${dossier.nom} ?`)}</b>
        {fr(`${proposition.libelle}. Rien n'est enregistré sans votre accord.`)}
        {erreur === null ? null : (
          <span className="mails-erreur" role="alert" data-testid="proposition-temps-erreur">
            {fr(erreur)}
          </span>
        )}
      </div>
      <div className="mails-encart__boutons">
        <label className="mails-encart__minutes">
          <span className="sr-only">{fr("Minutes à saisir")}</span>
          <input
            type="text"
            inputMode="numeric"
            data-testid="proposition-temps-minutes"
            value={saisie}
            aria-invalid={minutes === null}
            onChange={(event) => {
              setSaisie(event.target.value);
            }}
          />
          <span aria-hidden>{fr("min")}</span>
        </label>
        <button
          type="button"
          data-fort="true"
          data-testid="proposition-temps-saisir"
          disabled={minutes === null || enCours}
          onClick={() => {
            if (minutes !== null) onSaisir(minutes);
          }}
        >
          {fr(libelleBoutonSaisie(minutes ?? proposition.minutes))}
        </button>
        <button type="button" data-testid="proposition-temps-ecarter" disabled={enCours} onClick={onEcarter}>
          {fr("Pas maintenant")}
        </button>
      </div>
    </div>
  );
}

type TempsSaisiProps = { minutes: number; dossierNom: string };

/** Confirmation affichée à la place de la proposition une fois le temps saisi. */
export function TempsSaisi({ minutes, dossierNom }: TempsSaisiProps) {
  return (
    <p className="mails-temps-saisi" role="status" data-testid="temps-saisi-confirmation">
      <IconCheck stroke={2} aria-hidden size={14} />
      {fr(`Temps saisi : ${String(minutes)} min sur ${dossierNom}.`)}
    </p>
  );
}
