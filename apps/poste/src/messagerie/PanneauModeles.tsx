import { fr } from "@/lib/fr";
import type { ModeleMessage } from "@/messagerie/corpsRedaction";

type PanneauModelesProps = {
  modeles: readonly ModeleMessage[];
  enLigne: boolean;
  onChoisir: (modele: ModeleMessage) => void;
  /** Modèle choisi dont l'application remplacerait ce que l'utilisateur a écrit, et la phrase qui le dit. */
  confirmation: { modele: ModeleMessage; phrase: string } | null;
  onConfirmer: () => void;
  onAnnuler: () => void;
};

/**
 * Choix d'un modèle de message sous la barre d'outils de la rédaction (maquette : bouton « Modèle »). Un modèle choisi
 * qui remplacerait du texte déjà écrit demande d'abord confirmation.
 */
export function PanneauModeles({ modeles, enLigne, onChoisir, confirmation, onConfirmer, onAnnuler }: PanneauModelesProps) {
  return (
    <div className="mails-redac__modeles" role="group" aria-label={fr("Modèles de message")} data-testid="panneau-modeles">
      {confirmation !== null ? (
        <div className="mails-redac__confirmation" role="alert" data-testid="modele-confirmation">
          <span>{fr(confirmation.phrase)}</span>
          <button type="button" data-fort="true" data-testid="modele-remplacer" onClick={onConfirmer}>
            {fr("Remplacer")}
          </button>
          <button type="button" data-testid="modele-annuler" onClick={onAnnuler}>
            {fr("Garder mon texte")}
          </button>
        </div>
      ) : modeles.length === 0 ? (
        <p data-testid="modeles-vide">
          {fr(
            enLigne
              ? "Aucun modèle de message. Ajoutez-en dans Réglages, rubrique Messagerie."
              : "Aucun modèle enregistré sur ce poste. La liste se charge dès que la connexion revient.",
          )}
        </p>
      ) : (
        <>
          <ul>
            {modeles.map((modele) => (
              <li key={modele.id}>
                <button
                  type="button"
                  data-testid="modele-choix"
                  data-nom={modele.nom}
                  onClick={() => {
                    onChoisir(modele);
                  }}
                >
                  {fr(modele.nom)}
                </button>
              </li>
            ))}
          </ul>
          {enLigne ? null : (
            <p data-testid="modeles-copie-locale">{fr("Hors ligne : liste enregistrée sur ce poste.")}</p>
          )}
        </>
      )}
    </div>
  );
}
