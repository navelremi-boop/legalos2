import { Fragment } from "react";
import { fr } from "@/lib/fr";

/** Références de dossier ou de facture (« 2026-042 », « 2026-0142 ») et numéros RG (« 25/04417 »). */
const REFERENCE = /(\b\d{4}-\d{3,4}\b|\b\d{2}\/\d{5}\b)/u;

/**
 * Texte dont les références gardent le zéro barré (docs/design.md, Chiffres) ;
 * le reste suit la police d'interface.
 */
export function TexteReferences({ texte }: { texte: string }) {
  const morceaux = fr(texte).split(REFERENCE);
  return (
    <>
      {morceaux.map((morceau, index) =>
        index % 2 === 1 ? (
          <span key={`${String(index)}-${morceau}`} className="chiffres-reference">
            {morceau}
          </span>
        ) : (
          <Fragment key={`${String(index)}-${morceau}`}>{morceau}</Fragment>
        ),
      )}
    </>
  );
}
