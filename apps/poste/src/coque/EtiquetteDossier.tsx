import { fr } from "@/lib/fr";
import { libelleReferenceDossier } from "@/lib/referenceDossier";

type EtiquetteDossierProps = {
  /** Référence serveur, ou null/vide → « en attente ». */
  reference: string | null | undefined;
  nom: string;
};

export function EtiquetteDossier({ reference, nom }: EtiquetteDossierProps) {
  const libelle = libelleReferenceDossier(reference);
  return (
    <div className="etiquette-dossier" data-testid="etiquette-dossier">
      <span className="etiquette-dossier__ref" data-reference={libelle}>
        {fr(`Dossier ${libelle}`)}
      </span>
      <h2 className="etiquette-dossier__nom">{fr(nom)}</h2>
    </div>
  );
}
