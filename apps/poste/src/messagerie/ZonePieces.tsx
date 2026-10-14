import { IconX } from "@tabler/icons-react";
import { fr } from "@/lib/fr";
import {
  annonceTailleMax,
  extensionDe,
  formatTaille,
  tailleCumulee,
  TAILLE_MAX_CUMULEE,
  type PieceAffichee,
} from "@/messagerie/piecesRedaction";

type ZonePiecesProps = {
  pieces: readonly PieceAffichee[];
  onRetirer: (cle: string) => void;
  onEcarter: (cle: string) => void;
  /** Un transfert conserve les pièces du message d'origine : le dire. */
  transfert: boolean;
};

/** Pièces jointes du message, avec la taille maximale annoncée en permanence (déposer un fichier n'importe où dans la rédaction l'ajoute). */
export function ZonePieces({ pieces, onRetirer, onEcarter, transfert }: ZonePiecesProps) {
  const total = tailleCumulee(pieces.filter((piece) => piece.etat !== "refusee").map((piece) => ({ taille: piece.taille ?? 0 })));
  return (
    <div className="mails-redac__pieces" data-testid="redac-pieces">
      {pieces.length > 0 ? (
        <ul className="mails-pj" aria-label={fr("Pièces jointes")}>
          {pieces.map((piece) => {
            const extension = extensionDe(piece.nom);
            return (
              <li key={piece.cle} className="mails-redac__piece" data-testid="redac-piece" data-etat={piece.etat} data-nom={piece.nom}>
                <span className="mails-fichier">
                  {extension === "" ? null : <i>{extension}</i>}
                  {fr(piece.nom)}
                  {piece.taille === null ? null : <small>{fr(formatTaille(piece.taille))}</small>}
                  {piece.etat === "en-cours" ? <small>{fr("ajout en cours")}</small> : null}
                  {piece.etat === "conservee" ? <small>{fr("conservée au transfert")}</small> : null}
                  <button
                    type="button"
                    className="mails-redac__retirer"
                    data-testid="redac-piece-retirer"
                    aria-label={fr(`Retirer ${piece.nom}`)}
                    disabled={piece.etat === "en-cours" || piece.etat === "conservee"}
                    onClick={() => {
                      if (piece.etat === "refusee") onEcarter(piece.cle);
                      else onRetirer(piece.cle);
                    }}
                  >
                    <IconX stroke={1.8} aria-hidden />
                  </button>
                </span>
                {piece.etat === "refusee" && piece.message !== undefined ? (
                  <span className="mails-erreur mails-redac__piece-erreur" role="alert" data-testid="redac-piece-refus">
                    {fr(piece.message)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="mails-redac__annonce" data-testid="redac-annonce-taille" data-max={String(TAILLE_MAX_CUMULEE)}>
        {annonceTailleMax()}
        {pieces.length > 0 && total > 0 ? ` ${fr(`Joint : ${formatTaille(total)}.`)}` : ""}
        {transfert && pieces.some((piece) => piece.etat !== "refusee") ? ` ${fr("Les pièces du message d'origine sont conservées.")}` : ""}
      </p>
    </div>
  );
}
