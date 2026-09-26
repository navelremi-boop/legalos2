import { fr } from "@/lib/fr";
import { libelleEtiquetteReference, libelleReferenceDossier } from "@/lib/referenceDossier";

type EtiquetteDossierProps = {
  /** Référence serveur, ou null/vide → « Référence en attente ». */
  reference: string | null | undefined;
  nom: string;
};

export function EtiquetteDossier({ reference, nom }: EtiquetteDossierProps) {
  return (
    <div className="etiquette-dossier" data-testid="etiquette-dossier">
      <span className="etiquette-dossier__ref" data-reference={libelleReferenceDossier(reference)}>
        {fr(libelleEtiquetteReference(reference))}
      </span>
      <h2 className="etiquette-dossier__nom">{fr(nom)}</h2>
    </div>
  );
}
