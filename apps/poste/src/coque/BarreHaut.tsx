import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fr } from "@/lib/fr";
import { formatDuree } from "@/lib/format";

export type NavId =
  | "journee"
  | "dossiers"
  | "mails"
  | "agenda"
  | "facturation"
  | "reglages"
  | "dossier"
  | "galerie";

export type OngletDossier = {
  id: string;
  reference: string;
  nom: string;
  chemise: string;
};

export type SyncEtat =
  | { kind: "synchronise" }
  | { kind: "hors-ligne"; enAttente: number };

type BarreHautProps = {
  actif: NavId;
  onNaviguer: (id: NavId) => void;
  onglets?: OngletDossier[];
  ongletActifId?: string | null;
  onOngletActiver?: (id: string) => void;
  onOngletFermer?: (id: string) => void;
  sync: SyncEtat;
  /** Libellé déjà formaté (§ 7.7), sinon `chronoSecondes`. */
  chronoLibelle?: string;
  chronoSecondes?: number;
  onChrono?: () => void;
  onPalette?: () => void;
  mailsCompteur?: number;
  compteMenu?: ReactNode;
};

const NAV: { id: NavId; label: string }[] = [
  { id: "journee", label: "La journée" },
  { id: "dossiers", label: "Dossiers" },
  { id: "mails", label: "Mails" },
  { id: "agenda", label: "Agenda" },
  { id: "facturation", label: "Facturation" },
];

/** Largeur d’un onglet après réduction CSS (§ 7.4), hors menu. */
const LARGEUR_ONGLET_REDUIT = 170;
const LARGEUR_MENU = 44;
const GAP = 12;

export function BarreHaut({
  actif,
  onNaviguer,
  onglets = [],
  ongletActifId = null,
  onOngletActiver,
  onOngletFermer,
  sync,
  chronoLibelle,
  chronoSecondes,
  onChrono,
  onPalette,
  mailsCompteur = 0,
  compteMenu,
}: BarreHautProps) {
  const syncTexte =
    sync.kind === "synchronise"
      ? fr("Synchronisé")
      : fr(`Hors ligne, ${String(sync.enAttente)} modifications en attente`);

  const chronoAffiche =
    chronoLibelle ??
    (chronoSecondes !== undefined ? formatDuree(chronoSecondes) : formatDuree(0));

  const pisteRef = useRef<HTMLDivElement>(null);
  const droiteRef = useRef<HTMLDivElement>(null);
  const [visibles, setVisibles] = useState(onglets.length);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const ongletsCle = onglets.map((o) => o.id).join("|");
  const [cleSuivie, setCleSuivie] = useState(ongletsCle);

  if (ongletsCle !== cleSuivie) {
    setCleSuivie(ongletsCle);
    setVisibles(onglets.length);
    setMenuOuvert(false);
  }

  const recalculer = useCallback(() => {
    const piste = pisteRef.current;
    const droite = droiteRef.current;
    if (!piste || !droite) {
      setVisibles(onglets.length);
      return;
    }
    const dispo = Math.max(
      0,
      droite.getBoundingClientRect().left - piste.getBoundingClientRect().left - 4,
    );
    if (onglets.length === 0) {
      setVisibles(0);
      return;
    }
    // Combien d’onglets réduits tiennent, en réservant le menu s’il en reste.
    let capacite = 0;
    for (let n = 1; n <= onglets.length; n += 1) {
      const needMenu = n < onglets.length;
      const largeur =
        n * LARGEUR_ONGLET_REDUIT +
        (n - 1) * GAP +
        (needMenu ? GAP + LARGEUR_MENU : 0);
      if (largeur > dispo) break;
      capacite = n;
    }
    // Au moins l’onglet actif (ou le premier) reste visible s’il y a de la place.
    if (capacite === 0 && dispo >= LARGEUR_ONGLET_REDUIT) {
      capacite = 1;
    }
    setVisibles(capacite);
    if (capacite < onglets.length) {
      setMenuOuvert(false);
    }
  }, [onglets.length]);

  useEffect(() => {
    const barre = pisteRef.current?.closest(".barre-haut");
    if (!barre) return;
    const ro = new ResizeObserver(() => {
      recalculer();
    });
    ro.observe(barre);
    const frame = requestAnimationFrame(() => {
      recalculer();
    });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [recalculer, ongletsCle, ongletActifId, actif]);

  const ongletsVisibles = onglets.slice(0, visibles);
  let affiches = ongletsVisibles;
  if (
    ongletActifId &&
    visibles > 0 &&
    !ongletsVisibles.some((o) => o.id === ongletActifId)
  ) {
    const actifO = onglets.find((o) => o.id === ongletActifId);
    if (actifO) {
      affiches = [...ongletsVisibles.slice(0, Math.max(0, visibles - 1)), actifO];
    }
  }
  const idsAffiches = new Set(affiches.map((o) => o.id));
  const ongletsMenu = onglets.filter((o) => !idsAffiches.has(o.id));
  const aOverflow = ongletsMenu.length > 0;

  return (
    <header className="barre-haut" data-testid="barre-haut" role="banner">
      <nav
        className="mb-3 flex shrink-0 items-center gap-1 self-center text-[length:var(--font-size-dense)]"
        aria-label={fr("Navigation principale")}
      >
        {NAV.map((item) => {
          const estActif = actif === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={
                estActif
                  ? "rounded-[8px] px-2.5 py-1.5 font-bold text-barre-pilule"
                  : "rounded-[8px] px-2.5 py-1.5 text-barre-texte-muet hover:text-barre-texte"
              }
              aria-current={estActif ? "page" : undefined}
              onClick={() => {
                onNaviguer(item.id);
              }}
            >
              {fr(item.label)}
              {item.id === "mails" && mailsCompteur > 0 ? (
                <span className="barre-haut__compteur">{mailsCompteur}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div
        ref={pisteRef}
        className="onglets-piste mb-0 flex min-w-0 flex-1 items-end gap-3"
        role="tablist"
        aria-label={fr("Dossiers ouverts")}
      >
        {affiches.map((onglet) => {
          const actifOnglet = onglet.id === ongletActifId && actif === "dossier";
          return (
            <div
              key={onglet.id}
              data-chemise={onglet.chemise}
              className={
                actifOnglet
                  ? "onglet-dossier onglet-dossier--actif"
                  : "onglet-dossier onglet-dossier--inactif"
              }
              role="presentation"
            >
              {!actifOnglet ? <span className="onglet-dossier__pastille" aria-hidden /> : null}
              <button
                type="button"
                role="tab"
                aria-selected={actifOnglet}
                className="onglet-dossier__nom"
                onClick={() => {
                  onOngletActiver?.(onglet.id);
                }}
              >
                {fr(onglet.nom)}
              </button>
              <button
                type="button"
                className="onglet-dossier__fermer"
                aria-label={fr(`Fermer ${onglet.nom}`)}
                onClick={() => {
                  onOngletFermer?.(onglet.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}

        {aOverflow ? (
          <div className="onglets-overflow">
            <button
              type="button"
              className="onglets-overflow__btn"
              aria-expanded={menuOuvert}
              aria-haspopup="menu"
              aria-label={fr("Dossiers ouverts supplémentaires")}
              data-testid="onglets-overflow"
              onClick={() => {
                setMenuOuvert((v) => !v);
              }}
            >
              ···
            </button>
            {menuOuvert ? (
              <ul
                className="onglets-overflow__menu"
                role="menu"
                aria-label={fr("Dossiers ouverts")}
              >
                {ongletsMenu.map((onglet) => (
                  <li key={onglet.id} role="none" className="onglets-overflow__ligne">
                    <button
                      type="button"
                      role="menuitem"
                      data-chemise={onglet.chemise}
                      className="onglets-overflow__item"
                      onClick={() => {
                        onOngletActiver?.(onglet.id);
                        setMenuOuvert(false);
                      }}
                    >
                      <span className="onglet-dossier__pastille" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{fr(onglet.nom)}</span>
                    </button>
                    <button
                      type="button"
                      className="onglet-dossier__fermer"
                      aria-label={fr(`Fermer ${onglet.nom}`)}
                      onClick={() => {
                        onOngletFermer?.(onglet.id);
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        ref={droiteRef}
        className="mb-3 flex shrink-0 items-center gap-2 self-center text-[length:var(--font-size-dense)] text-barre-texte-muet"
      >
        <span className="mr-1 flex items-center gap-1.5 text-[12px]" data-testid="indicateur-sync" role="status">
          <i className="barre-haut__sync-point" aria-hidden />
          {syncTexte}
        </span>

        {onChrono !== undefined ? (
          <button
            type="button"
            className="barre-haut__pilule"
            onClick={onChrono}
            aria-label={fr("Chronomètre")}
            data-testid="chrono-barre"
          >
            <span className="barre-haut__chrono-point" aria-hidden />
            <b className="font-bold text-barre-pilule">{chronoAffiche}</b>
          </button>
        ) : null}

        {onPalette !== undefined ? (
          <button
            type="button"
            className="barre-haut__pilule"
            onClick={onPalette}
            aria-label={fr("Palette de commandes")}
          >
            {fr("Rechercher")}
            <kbd className="barre-haut__kbd">Ctrl K</kbd>
          </button>
        ) : null}

        {compteMenu}
      </div>
    </header>
  );
}
