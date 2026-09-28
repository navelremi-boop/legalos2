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
import { instanceReachable } from "@/lib/instanceReachable";
import { libelleReferenceDossier } from "@/lib/referenceDossier";
import { DossierOuvert, type DossierVue } from "@/screens/DossierOuvert";
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

type DossierLocal = {
  id: string;
  nom: string;
  chemise: string;
  reference: string | null;
  juridiction: string;
  numero_rg: string;
};

export function CoqueApp({ instanceUrl, onResetSession, onReconnect }: CoqueAppProps) {
  const [nav, setNav] = useState<NavId>("journee");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  /** Onglets ouverts : uniquement des dossiers réels (jamais DOSSIERS_DEMO). */
  const [onglets, setOnglets] = useState<OngletDossier[]>([]);
  const [ongletActifId, setOngletActifId] = useState<string | null>(null);
  const [dossierCharge, setDossierCharge] = useState<DossierVue | null>(null);
  const [panneau, setPanneau] = useState<Panneau>("aucun");
  const [menuCompteOuvert, setMenuCompteOuvert] = useState(false);
  const [enAttente, setEnAttente] = useState(0);
  const [navigateurHorsLigne, setNavigateurHorsLigne] = useState(!navigator.onLine);
  const [instanceHorsLigne, setInstanceHorsLigne] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const onOnline = () => {
      setNavigateurHorsLigne(false);
    };
    const onOffline = () => {
      setNavigateurHorsLigne(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  /** Coupure réelle vers l'instance (réseau local OK mais serveur injoignable). */
  useEffect(() => {
    let stop = false;
    const sonder = () => {
      void instanceReachable(instanceUrl).then((ok) => {
        if (!stop) setInstanceHorsLigne(!ok);
      });
    };
    sonder();
    const timer = window.setInterval(sonder, 4_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [instanceUrl]);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          database.getAll<{ n: number }>("SELECT COUNT(*) AS n FROM ps_crud"),
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
    const ids = ongletsIds.split("|").filter((id) => id.length > 0);
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

  /** Charge les infos réelles du dossier actif (pas le jeu DOSSIERS_DEMO). */
  useEffect(() => {
    if (!ongletActifId || nav !== "dossier") return;
    const cible = ongletActifId;
    let stop = false;
    const charger = () => {
      void getPowerSyncDatabase()
        .then(async (database) => {
          const rows = await database.getAll<DossierLocal>(
            `SELECT id, nom, chemise, reference, juridiction, numero_rg
             FROM dossiers WHERE id = ? LIMIT 1`,
            [cible],
          );
          const row = rows[0];
          if (!row || !isChemiseId(row.chemise)) return null;
          const parties = await database.getAll<{ role: string; nom: string }>(
            "SELECT role, nom FROM parties WHERE dossier_id = ?",
            [cible],
          );
          const client =
            parties.find((p) => p.role === "client")?.nom ??
            parties.find((p) => p.role === "demandeur")?.nom ??
            "";
          const adversaire =
            parties.find((p) => p.role === "adversaire")?.nom ??
            parties.find((p) => p.role === "defendeur")?.nom ??
            "";
          return {
            id: row.id,
            reference: libelleReferenceDossier(row.reference),
            nom: row.nom,
            chemise: row.chemise,
            juridiction: row.juridiction || "—",
            numeroRg: row.numero_rg || "—",
            client: client || "—",
            adversaire: adversaire || "—",
          } satisfies DossierVue;
        })
        .then((vue) => {
          if (!stop) setDossierCharge(vue);
        })
        .catch(() => {
          if (!stop) setDossierCharge(null);
        });
    };
    charger();
    const timer = window.setInterval(charger, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [ongletActifId, nav]);

  const horsLigne = navigateurHorsLigne || instanceHorsLigne;

  const sync: SyncEtat = useMemo(() => {
    if (horsLigne) {
      return { kind: "hors-ligne", enAttente };
    }
    return { kind: "synchronise" };
  }, [horsLigne, enAttente]);

  const dossierActif =
    nav === "dossier" && ongletActifId && dossierCharge?.id === ongletActifId
      ? dossierCharge
      : null;

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
      setPanneau("aucun");
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
    contenu = (
      <Dossiers
        onOuvrirDossier={ouvrirDossier}
        onNouveauDossier={() => {
          setPanneau("dossier-form");
        }}
      />
    );
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
  } else if (nav === "dossier") {
    contenu = (
      <div className="fond-neutre flex h-full items-center justify-center" data-testid="ecran-dossier-chargement">
        <p className="text-sur-chemise">{fr("Chargement du dossier…")}</p>
      </div>
    );
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
            {panneau === "dossier-form" ? (
              <FormulaireDossier
                onCree={({ id, nom, chemise, reference }) => {
                  ouvrirDossier(id, nom, chemise, reference);
                }}
              />
            ) : null}
            {panneau === "temps" ? (
              <FormulaireTemps
                instanceUrl={instanceUrl}
                dossierIdPrefere={ongletActifId}
              />
            ) : null}
            {panneau === "delai" ? <FormulaireDelai /> : null}
            {panneau === "palette" ? (
              <PaletteCommandes
                ouverteParDefaut
                onChoisirDossier={ouvrirDossier}
                onNouveauDossier={() => {
                  setPanneau("dossier-form");
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
