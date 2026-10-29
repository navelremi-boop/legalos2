import { fr } from "@/lib/fr";

type AnnonceProps = {
  texte: string;
  /** Une confirmation s'efface d'elle-même ; un refus ou une erreur reste affiché jusqu'au message suivant. */
  succes: boolean;
  testId?: string;
};

/**
 * Message bref affiché en bas de la zone de travail (écran ou panneau), près de l'action qui l'a produit.
 * Le texte reste dans le document : lecteurs d'écran et recettes le lisent toujours.
 * La clé relance l'apparition à chaque nouveau message.
 */
export function Annonce({ texte, succes, testId }: AnnonceProps) {
  return (
    <p
      key={texte}
      className="annonce"
      data-vide={texte === "" ? "true" : "false"}
      data-ton={succes ? "succes" : "erreur"}
      role="status"
      data-testid={testId}
    >
      {fr(texte)}
    </p>
  );
}
