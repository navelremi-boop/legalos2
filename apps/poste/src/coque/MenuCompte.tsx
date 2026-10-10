import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fr } from "@/lib/fr";

export type MenuCompteProps = {
  onTemps: () => void;
  onReglages: () => void;
  onPalette: () => void;
  /** Verrouiller : retour à l'authentification, données locales conservées. Absent : entrée inactive. */
  onVerrouiller?: () => void;
  /** Se déconnecter : session effacée. Absent : entrée inactive. */
  onDeconnecter?: () => void;
  /** Entrée de développement, absente des builds distribués. */
  onGalerie?: () => void;
};

type Entree = {
  testid: string;
  libelle: string;
  action?: () => void;
  separateur?: boolean;
};

/**
 * Menu du compte, à droite de la barre haute : Temps, Réglages, Palette de commandes, Verrouiller,
 * Se déconnecter. S'ouvre au clic et à Entrée (ou Espace) sur le bouton, se ferme par Échap, par un
 * clic extérieur ou par le choix d'une entrée. Rendu dans un portail : la barre haute coupe ce qui
 * dépasse (`overflow: hidden`).
 */
export function MenuCompte({
  onTemps,
  onReglages,
  onPalette,
  onVerrouiller,
  onDeconnecter,
  onGalerie,
}: MenuCompteProps) {
  const [ouvert, setOuvert] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const boutonRef = useRef<HTMLButtonElement>(null);
  const listeRef = useRef<HTMLUListElement>(null);
  const idBouton = useId();

  const fermer = useCallback((rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) boutonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!ouvert) return;
    listeRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const surTouche = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        fermer(true);
      }
    };
    const surClicExterieur = (event: MouseEvent) => {
      const cible = event.target;
      if (!(cible instanceof Node)) return;
      if (listeRef.current?.contains(cible) || boutonRef.current?.contains(cible)) return;
      fermer(false);
    };
    const surRedimensionnement = () => {
      fermer(false);
    };
    document.addEventListener("keydown", surTouche, true);
    document.addEventListener("mousedown", surClicExterieur, true);
    window.addEventListener("resize", surRedimensionnement);
    return () => {
      document.removeEventListener("keydown", surTouche, true);
      document.removeEventListener("mousedown", surClicExterieur, true);
      window.removeEventListener("resize", surRedimensionnement);
    };
  }, [ouvert, fermer]);

  const entrees: Entree[] = [
    { testid: "menu-compte-temps", libelle: "Temps", action: onTemps },
    { testid: "menu-reglages", libelle: "Réglages", action: onReglages },
    { testid: "menu-compte-palette", libelle: "Palette de commandes", action: onPalette },
    { testid: "menu-compte-verrouiller", libelle: "Verrouiller", action: onVerrouiller, separateur: true },
    { testid: "menu-compte-deconnexion", libelle: "Se déconnecter", action: onDeconnecter },
    ...(onGalerie !== undefined
      ? [{ testid: "menu-compte-galerie", libelle: "Galerie (dev)", action: onGalerie, separateur: true }]
      : []),
  ];

  const surToucheListe = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = [
      ...(listeRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    if (items.length === 0) return;
    const courant = items.indexOf(document.activeElement as HTMLElement);
    let suivant: number | null = null;
    if (event.key === "ArrowDown") suivant = (courant + 1) % items.length;
    else if (event.key === "ArrowUp") suivant = (courant - 1 + items.length) % items.length;
    else if (event.key === "Home") suivant = 0;
    else if (event.key === "End") suivant = items.length - 1;
    else if (event.key === "Tab") {
      fermer(false);
      return;
    }
    if (suivant !== null) {
      event.preventDefault();
      items[suivant]?.focus();
    }
  };

  return (
    <div className="relative">
      <button
        ref={boutonRef}
        id={idBouton}
        type="button"
        className="barre-haut__pilule"
        aria-expanded={ouvert}
        aria-haspopup="menu"
        data-testid="menu-compte"
        onClick={(event) => {
          if (ouvert) {
            fermer(false);
            return;
          }
          const r = event.currentTarget.getBoundingClientRect();
          setPosition({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
          setOuvert(true);
        }}
      >
        {fr("Compte")}
      </button>
      {ouvert
        ? createPortal(
            <ul
              ref={listeRef}
              role="menu"
              aria-labelledby={idBouton}
              data-testid="menu-compte-liste"
              className="fixed z-[60] min-w-[220px] rounded-[var(--radius-control)] bg-feuille p-1 text-encre shadow-[var(--ombre-etiquette)]"
              style={{ top: position.top, right: position.right }}
              onKeyDown={surToucheListe}
            >
              {entrees.map((entree) => (
                <li
                  key={entree.testid}
                  role="none"
                  className={entree.separateur === true ? "mt-1 border-t border-filet pt-1" : undefined}
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={entree.action === undefined}
                    data-testid={entree.testid}
                    className="w-full rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-survol focus-visible:bg-survol disabled:text-graphite disabled:hover:bg-transparent"
                    onClick={() => {
                      entree.action?.();
                      fermer(false);
                    }}
                  >
                    {fr(entree.libelle)}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
