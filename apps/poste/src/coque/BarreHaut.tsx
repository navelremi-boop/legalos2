import type { ReactNode } from "react";
import { fr } from "@/lib/fr";

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
  chronoLibelle?: string;
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

export function BarreHaut({
  actif,
  onNaviguer,
  onglets = [],
  ongletActifId = null,
  onOngletActiver,
  onOngletFermer,
  sync,
  chronoLibelle,
  onChrono,
  onPalette,
  mailsCompteur = 0,
  compteMenu,
}: BarreHautProps) {
  const syncTexte =
    sync.kind === "synchronise"
      ? fr("Synchronisé")
      : fr(`Hors ligne, ${String(sync.enAttente)} modifications en attente`);

  return (
    <header className="barre-haut" data-testid="barre-haut" role="banner">
      <nav
        className="mb-3 flex items-center gap-1 self-center text-[length:var(--font-size-dense)]"
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
        className="mb-0 flex flex-1 items-end gap-3 overflow-hidden"
        role="tablist"
        aria-label={fr("Dossiers ouverts")}
      >
        {onglets.map((onglet) => {
          const actifOnglet = onglet.id === ongletActifId && actif === "dossier";
          return (
            <div
              key={onglet.id}
              data-chemise={onglet.chemise}
              className={
                actifOnglet ? "onglet-dossier onglet-dossier--actif" : "onglet-dossier onglet-dossier--inactif"
              }
              role="presentation"
            >
              {!actifOnglet ? <span className="onglet-dossier__pastille" aria-hidden /> : null}
              <button
                type="button"
                role="tab"
                aria-selected={actifOnglet}
                className="max-w-[140px] truncate text-[length:var(--font-size-dense)]"
                onClick={() => {
                  onOngletActiver?.(onglet.id);
                }}
              >
                {fr(onglet.nom)}
              </button>
              <button
                type="button"
                className="opacity-55 hover:opacity-100"
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
      </div>

      <div className="mb-3 flex items-center gap-2 self-center text-[length:var(--font-size-dense)] text-barre-texte-muet">
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
            <b className="font-bold text-barre-pilule">{chronoLibelle ?? "0:00:00"}</b>
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
