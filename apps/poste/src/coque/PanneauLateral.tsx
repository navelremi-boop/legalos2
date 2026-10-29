import { useEffect, useRef, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { fr } from "@/lib/fr";

type PanneauLateralProps = {
  ouvert: boolean;
  titre: string;
  sousTitre?: string;
  onFermer: () => void;
  children: ReactNode;
  testId?: string;
};

/**
 * Panneau latéral des formulaires secondaires (docs/design.md, Composants).
 * Le contenu reste monté quand le panneau est fermé : les saisies en cours sont conservées.
 */
export function PanneauLateral({ ouvert, titre, sousTitre, onFermer, children, testId }: PanneauLateralProps) {
  const carte = useRef<HTMLDivElement>(null);
  const fermer = useRef(onFermer);
  useEffect(() => {
    fermer.current = onFermer;
  }, [onFermer]);

  useEffect(() => {
    if (!ouvert) return;
    const premier = carte.current?.querySelector<HTMLElement>(
      "input:not([type=hidden]), select, textarea, button:not([data-fermer])",
    );
    premier?.focus({ preventScroll: true });
    const touche = (event: KeyboardEvent) => {
      if (event.key === "Escape") fermer.current();
    };
    window.addEventListener("keydown", touche);
    return () => {
      window.removeEventListener("keydown", touche);
    };
  }, [ouvert]);

  return (
    <div
      className="panneau-lateral"
      hidden={!ouvert}
      data-testid={testId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onFermer();
      }}
    >
      <div ref={carte} className="panneau-lateral__carte" role="dialog" aria-modal="true" aria-label={fr(titre)}>
        <div className="panneau-lateral__tete">
          <div>
            <h2 className="panneau-lateral__titre">{fr(titre)}</h2>
            {sousTitre ? <p className="panneau-lateral__sous-titre">{fr(sousTitre)}</p> : null}
          </div>
          <button type="button" className="bouton bouton--discret bouton--petit" data-fermer onClick={onFermer}>
            <IconX size={16} aria-hidden />
            {fr("Fermer")}
          </button>
        </div>
        <div className="panneau-lateral__corps">{children}</div>
      </div>
    </div>
  );
}
