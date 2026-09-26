import { fr } from "@/lib/fr";

type EtiquetteDossierProps = {
  reference: string;
  nom: string;
};

export function EtiquetteDossier({ reference, nom }: EtiquetteDossierProps) {
  return (
    <div className="etiquette-dossier" data-testid="etiquette-dossier">
      <span className="etiquette-dossier__ref">{fr(`Dossier ${reference}`)}</span>
      <h2 className="etiquette-dossier__nom">{fr(nom)}</h2>
    </div>
  );
}
