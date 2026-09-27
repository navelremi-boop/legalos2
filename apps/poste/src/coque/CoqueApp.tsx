import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BarreHaut,
  type NavId,
  type OngletDossier,
  type SyncEtat,
} from "@/coque/BarreHaut";
import { FormulaireDelai } from "@/delais/FormulaireDelai";
import { FormulaireTemps } from "@/facturation/FormulaireTemps";
import { FormulaireDossier } from "@/dossiers/FormulaireDossier";
import { PaletteCommandes } from "@/dossiers/PaletteCommandes";
import { isChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import {
  libelleReferenceDossier,
} from "@/lib/referenceDossier";
import { DossierOuvert, DOSSIERS_DEMO, type DossierDemo } from "@/screens/DossierOuvert";
import { Dossiers } from "@/screens/Dossiers";
import { EcranStub } from "@/screens/EcranStub";
import { Journee } from "@/screens/Journee";
import { Reglages, type ThemeMode } from "@/screens/Reglages";
import { getPowerSyncDatabase } from "@/sync/database";

/** Galerie absente des builds distribués (tree-shake via import.meta.env.DEV). */
const GalerieDemoLazy = import.meta.env.DEV
  ? lazy(() =>
      import("@/screens/GalerieDemo").then((m) => ({ default: m.GalerieDemo })),
    )
  : null;

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type Panneau = "aucun" | "dossier-form" | "temps" | "delai" | "palette";

type CoqueAppProps = {
  instanceUrl: string;
  onResetSession?: () => void;
  onReconnect?: () => void;
};

export function CoqueApp({ instanceUrl, onResetSession, onReconnect }: CoqueAppProps) {
  const [nav, setNav] = useState<NavId>("journee");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [onglets, setOnglets] = useState<OngletDossier[]>(() =>
    DOSSIERS_DEMO.map((d) => ({
      id: d.id,
      reference: d.reference,
      nom: d.nom,
      chemise: d.chemise,
    })),
  );
  const [ongletActifId, setOngletActifId] = useState<string | null>(DOSSIERS_DEMO[0]?.id ?? null);
  const [panneau, setPanneau] = useState<Panneau>("aucun");
  const [menuCompteOuvert, setMenuCompteOuvert] = useState(false);
  const [enAttente, setEnAttente] = useState(0);
  const [horsLigne, setHorsLigne] = useState(!navigator.onLine);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const onOnline = () => {
      setHorsLigne(false);
    };
    const onOffline = () => {
      setHorsLigne(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          database.getAll<{ n: number }>(
            "SELECT COUNT(*) AS n FROM journal_modifications WHERE sync_pending = 1",
          ),
        )
        .then((rows) => {
          if (!stop) setEnAttente(rows[0]?.n ?? 0);
        })
        .catch(() => {
          if (!stop) setEnAttente(0);
        });
    };
    tick();
    const timer = window.setInterval(tick, 3_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanneau("palette");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /** Met à jour les références serveur dès qu’elles descendent en SQLite (§ 3.4). */
  const ongletsIds = onglets.map((o) => o.id).join("|");
  useEffect(() => {
    const ids = ongletsIds.split("|").filter((id) => id.length > 0 && !id.startsWith("demo-"));
    if (ids.length === 0) return;
    let stop = false;
    const tick = () => {
      const placeholders = ids.map(() => "?").join(", ");
      void getPowerSyncDatabase()
        .then((database) =>
          database.getAll<{ id: string; reference: string | null }>(
            `SELECT id, reference FROM dossiers WHERE id IN (${placeholders})`,
            ids,
          ),
        )
        .then((rows) => {
          if (stop) return;
          setOnglets((prev) => {
            const next = prev.map((onglet) => {
              const row = rows.find((r) => r.id === onglet.id);
              if (!row) return onglet;
              const libelle = libelleReferenceDossier(row.reference);
              if (libelle === onglet.reference) return onglet;
              return { ...onglet, reference: libelle };
            });
            const changed = next.some(
              (onglet, index) => onglet.reference !== prev[index]?.reference,
            );
            return changed ? next : prev;
          });
        })
        .catch(() => {
          /* base pas encore prête */
        });
    };
    tick();
    const timer = window.setInterval(tick, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [ongletsIds]);

  const sync: SyncEtat = useMemo(() => {
    if (horsLigne || enAttente > 0) {
      return { kind: "hors-ligne", enAttente };
    }
    return { kind: "synchronise" };
  }, [horsLigne, enAttente]);

  const dossierActif: DossierDemo | null = useMemo(() => {
    if (!ongletActifId) return null;
    const demo = DOSSIERS_DEMO.find((d) => d.id === ongletActifId);
    if (demo) return demo;
    const onglet = onglets.find((o) => o.id === ongletActifId);
    if (!onglet || !isChemiseId(onglet.chemise)) return null;
    return {
      id: onglet.id,
      reference: onglet.reference,
      nom: onglet.nom,
      chemise: onglet.chemise,
      juridiction: "—",
      numeroRg: "—",
      client: "—",
      adversaire: "—",
    };
  }, [ongletActifId, onglets]);

  const ouvrirDossier = useCallback(
    (id: string, nom: string, chemise: string, reference?: string | null) => {
      const libelle = libelleReferenceDossier(reference);
      setOnglets((prev) => {
        if (prev.some((o) => o.id === id)) {
          return prev.map((o) =>
            o.id === id ? { ...o, nom, chemise, reference: libelle } : o,
          );
        }
        return [...prev, { id, reference: libelle, nom, chemise }];
      });
      setOngletActifId(id);
      setNav("dossier");
    },
    [],
  );

  const naviguer = useCallback((id: NavId) => {
    setNav(id);
    setMenuCompteOuvert(false);
  }, []);

  let contenu: ReactNode;
  if (import.meta.env.DEV && nav === "galerie" && GalerieDemoLazy) {
    contenu = (
      <Suspense fallback={null}>
        <GalerieDemoLazy />
      </Suspense>
    );
  } else if (nav === "journee") {
    contenu = (
      <Journee
        onNouveauDossier={() => {
          setPanneau("dossier-form");
        }}
        onNouveauMail={() => {
          setNav("mails");
        }}
        onSaisirTemps={() => {
          setPanneau("temps");
        }}
      />
    );
  } else if (nav === "dossiers") {
    contenu = <Dossiers onOuvrirDossier={ouvrirDossier} />;
  } else if (nav === "reglages") {
    contenu = (
      <Reglages
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        onResetSession={onResetSession}
        onReconnect={onReconnect}
        instanceUrl={instanceUrl}
        horsLigne={horsLigne}
      />
    );
  } else if (nav === "dossier" && dossierActif) {
    contenu = (
      <DossierOuvert
        dossier={dossierActif}
        onNouveauMail={() => {
          setNav("mails");
        }}
        onSaisirTemps={() => {
          setPanneau("temps");
        }}
        onFacturer={() => {
          setNav("facturation");
        }}
        onCalculerDelai={() => {
          setPanneau("delai");
        }}
      />
    );
  } else if (nav === "mails") {
    contenu = <EcranStub titre="Mails" testId="ecran-mails" />;
  } else if (nav === "agenda") {
    contenu = <EcranStub titre="Agenda" testId="ecran-agenda" />;
  } else if (nav === "facturation") {
    contenu = <EcranStub titre="Facturation" testId="ecran-facturation" />;
  } else {
    contenu = (
      <Journee
        onNouveauDossier={() => {
          setPanneau("dossier-form");
        }}
        onNouveauMail={() => {
          setNav("mails");
        }}
        onSaisirTemps={() => {
          setPanneau("temps");
        }}
      />
    );
  }

  const compteMenu = (
    <div className="relative">
      <button
        type="button"
        className="barre-haut__pilule"
        aria-expanded={menuCompteOuvert}
        aria-haspopup="menu"
        onClick={() => {
          setMenuCompteOuvert((v) => !v);
        }}
      >
        {fr("Compte")}
      </button>
      {menuCompteOuvert ? (
        <ul
          className="absolute right-0 bottom-full mb-2 min-w-[160px] rounded-[var(--radius-control)] bg-feuille p-1 text-encre shadow-[var(--ombre-etiquette)]"
          role="menu"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="w-full rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-survol"
              onClick={() => {
                setPanneau("temps");
                setMenuCompteOuvert(false);
              }}
            >
              {fr("Temps")}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="w-full rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-survol"
              onClick={() => {
                naviguer("reglages");
              }}
            >
              {fr("Réglages")}
            </button>
          </li>
          {import.meta.env.DEV ? (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-survol"
                onClick={() => {
                  naviguer("galerie");
                }}
              >
                {fr("Galerie (dev)")}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );

  return (
    <div className="coque-app">
      <BarreHaut
        actif={nav === "galerie" ? "journee" : nav}
        onNaviguer={naviguer}
        onglets={onglets}
        ongletActifId={ongletActifId}
        onOngletActiver={(id) => {
          setOngletActifId(id);
          setNav("dossier");
        }}
        onOngletFermer={(id) => {
          setOnglets((prev) => {
            const next = prev.filter((o) => o.id !== id);
            if (ongletActifId === id) {
              const premier = next[0];
              setOngletActifId(premier?.id ?? null);
              setNav(premier ? "dossier" : "journee");
            }
            return next;
          });
        }}
        sync={sync}
        chronoSecondes={nav === "dossier" ? 12 * 60 + 4 : undefined}
        onChrono={() => {
          setPanneau("temps");
        }}
        onPalette={() => {
          setPanneau("palette");
        }}
        compteMenu={compteMenu}
      />
      <div className="coque-workspace">{contenu}</div>

      {panneau !== "aucun" ? (
        <div
          className="panneau-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setPanneau("aucun");
          }}
        >
          <div
            className="panneau-modal__carte"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              className="mb-4 text-[length:var(--font-size-dense)] text-graphite"
              onClick={() => {
                setPanneau("aucun");
              }}
            >
              {fr("Fermer")}
            </button>
            {panneau === "dossier-form" ? <FormulaireDossier /> : null}
            {panneau === "temps" ? <FormulaireTemps instanceUrl={instanceUrl} /> : null}
            {panneau === "delai" ? <FormulaireDelai /> : null}
            {panneau === "palette" ? <PaletteCommandes /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
