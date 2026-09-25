import { useEffect, useRef, useState } from "react";
import { FormulaireDossier } from "@/dossiers/FormulaireDossier";
import { PaletteCommandes } from "@/dossiers/PaletteCommandes";
import { CHEMISE_IDS, type ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import { clearSession } from "@/lib/session/storage";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { getPowerSyncDatabase } from "@/sync/database";

type ThemeMode = "light" | "dark" | "system";

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type JourneePreviewProps = {
  instanceUrl: string;
  onResetSession?: () => void;
  onReconnect?: () => void;
};

export function JourneePreview({
  instanceUrl,
  onResetSession,
  onReconnect,
}: JourneePreviewProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [previewChemise, setPreviewChemise] = useState<ChemiseId>("bleu-classeur");
  const [conflits, setConflits] = useState(0);
  const [nom, setNom] = useState("");
  const [slug, setSlug] = useState("");
  const [baseNom, setBaseNom] = useState("");
  const [baseSlug, setBaseSlug] = useState("");
  const baseNomRef = useRef("");
  const baseSlugRef = useRef("");

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          Promise.all([
            database.getAll<{ n: number }>(
              "SELECT COUNT(*) AS n FROM journal_modifications WHERE conflit = 1",
            ),
            database.getAll<{ nom: string; slug: string }>(
              "SELECT nom, slug FROM cabinets WHERE id = ? LIMIT 1",
              [DEMO_CABINET_ID],
            ),
          ]),
        )
        .then(([conflitRows, cabinetRows]) => {
          if (stop) return;
          setConflits(conflitRows[0]?.n ?? 0);
          const cabinet = cabinetRows[0];
          if (!cabinet) return;
          const nomBase = baseNomRef.current;
          const slugBase = baseSlugRef.current;
          setNom((courant) => (courant === nomBase ? cabinet.nom : courant));
          setSlug((courant) => (courant === slugBase ? cabinet.slug : courant));
          baseNomRef.current = cabinet.nom;
          baseSlugRef.current = cabinet.slug;
          setBaseNom(cabinet.nom);
          setBaseSlug(cabinet.slug);
        })
        .catch(() => {
          if (!stop) {
            setConflits(0);
          }
        });
    };
    tick();
    const timer = window.setInterval(tick, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    void getPowerSyncDatabase()
      .then((database) =>
        database.getAll<{ nom: string; slug: string }>(
          "SELECT nom, slug FROM cabinets WHERE id = ? LIMIT 1",
          [DEMO_CABINET_ID],
        ),
      )
      .then((rows) => {
        if (stop || rows.length === 0) return;
        const nomLu = rows[0]?.nom ?? "";
        const slugLu = rows[0]?.slug ?? "";
        setNom(nomLu);
        setSlug(slugLu);
        baseNomRef.current = nomLu;
        baseSlugRef.current = slugLu;
        setBaseNom(nomLu);
        setBaseSlug(slugLu);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    const resolved = resolveTheme(themeMode);
    document.documentElement.dataset.theme = resolved;
  }, [themeMode]);

  return (
    <div className="min-h-screen bg-page text-encre">
      <header className="border-b border-filet bg-classeur px-8 py-6">
        <p className="text-[length:var(--font-size-dense)] text-graphite">
          {fr(`Instance : ${instanceUrl}`)}
        </p>
        <h1 className="mt-2 text-[length:var(--font-size-journee)] font-bold leading-tight">
          {fr("La journée")}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="theme">
            {fr("Thème")}
          </label>
          <select
            id="theme"
            className="rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-encre"
            value={themeMode}
            onChange={(event) => {
              setThemeMode(event.target.value as ThemeMode);
            }}
          >
            <option value="system">{fr("Système")}</option>
            <option value="light">{fr("Jour")}</option>
            <option value="dark">{fr("Nuit")}</option>
          </select>
          {onReconnect !== undefined ? (
            <button
              type="button"
              className="rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-[length:var(--font-size-dense)] text-graphite"
              data-testid="se-reconnecter"
              onClick={onReconnect}
            >
              {fr("Se reconnecter")}
            </button>
          ) : null}
          {onResetSession !== undefined ? (
            <button
              type="button"
              className="rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-[length:var(--font-size-dense)] text-graphite hover:border-graphite"
              onClick={() => {
                void clearSession().then(() => {
                  onResetSession();
                });
              }}
            >
              {fr("Se déconnecter (test)")}
            </button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-6">
          <PaletteCommandes />
        </div>
        <FormulaireDossier />
        <form
          className="mb-6 rounded-[var(--radius-control)] border border-filet bg-feuille px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formulaire = new FormData(event.currentTarget);
            const nomBrut = formulaire.get("nom");
            const slugBrut = formulaire.get("slug");
            const nomSaisi = typeof nomBrut === "string" ? nomBrut : nom;
            const slugSaisi = typeof slugBrut === "string" ? slugBrut : slug;
            const colonnes: string[] = [];
            const valeurs: string[] = [];
            if (nomSaisi !== baseNom) {
              colonnes.push("nom = ?");
              valeurs.push(nomSaisi);
            }
            if (slugSaisi !== baseSlug) {
              colonnes.push("slug = ?");
              valeurs.push(slugSaisi);
            }
            if (colonnes.length === 0) return;
            void (async () => {
              const database = await getPowerSyncDatabase();
              const actuels = await database.getAll<{ revision: number | null }>(
                "SELECT revision FROM cabinets WHERE id = ?",
                [DEMO_CABINET_ID],
              );
              const revision = actuels[0]?.revision ?? 1;
              await database.execute(
                "CREATE TABLE IF NOT EXISTS revision_edition (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
              );
              await database.execute(
                "INSERT INTO revision_edition (id, revision) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision",
                [DEMO_CABINET_ID, revision],
              );
              await database.execute(
                `UPDATE cabinets SET ${colonnes.join(", ")} WHERE id = ?`,
                [...valeurs, DEMO_CABINET_ID],
              );
            })();
            setNom(nomSaisi);
            setSlug(slugSaisi);
            baseNomRef.current = nomSaisi;
            baseSlugRef.current = slugSaisi;
            setBaseNom(nomSaisi);
            setBaseSlug(slugSaisi);
          }}
        >
          <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="cabinet-nom">
            {fr("Nom du cabinet")}
          </label>
          <input
            id="cabinet-nom"
            name="nom"
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            value={nom}
            onChange={(event) => {
              setNom(event.target.value);
            }}
          />
          <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="cabinet-slug">
            {fr("Slug du cabinet")}
          </label>
          <input
            id="cabinet-slug"
            name="slug"
            className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
          />
          <button
            type="submit"
            className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          >
            {fr("Enregistrer")}
          </button>
        </form>
        {conflits > 0 ? (
          <p
            className="mb-6 rounded-[var(--radius-control)] border border-filet bg-feuille px-4 py-3 text-encre"
            role="status"
            data-testid="conflit-sync"
          >
            {fr(
              `Conflit de synchronisation : ${String(conflits)} champ(s). La dernière écriture a été conservée ; la valeur remplacée est dans le journal.`,
            )}
          </p>
        ) : null}
        <section
          className="overflow-hidden rounded-[var(--radius-tab)] border border-filet bg-classeur"
          data-chemise={previewChemise}
        >
          <div className="bg-chemise-teinte px-8 py-6 text-chemise-texte">
            <p className="text-[length:var(--font-size-dense)] opacity-80">
              {fr("Aperçu bande de dossier")}
            </p>
            <h2 className="text-[length:var(--font-size-dossier)] font-bold">
              {fr("Dossier fictif — Ferrand Métal")}
            </h2>
          </div>

          <div className="border-t border-filet bg-feuille px-8 py-6">
            <p className="mb-4 text-[length:var(--font-size-dense)] text-graphite">
              {fr("Huit chemises (jetons design/tokens.css)")}
            </p>
            <ul className="divide-y divide-filet">
              {CHEMISE_IDS.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="flex h-11 w-full items-center gap-3 px-2 text-left hover:bg-classeur"
                    data-chemise={id}
                    onClick={() => {
                      setPreviewChemise(id);
                    }}
                  >
                    <span
                      className="h-[13px] w-[9px] shrink-0 rounded-[var(--radius-pastille)] bg-chemise-bande"
                      aria-hidden
                    />
                    <span>{fr(id.replace(/-/g, " "))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
