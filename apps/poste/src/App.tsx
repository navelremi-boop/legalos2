import { useEffect, useState } from "react";
import { fr } from "@/lib/fr";
import { CHEMISE_IDS, type ChemiseId } from "@/lib/chemise";

type ThemeMode = "light" | "dark" | "system";

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [previewChemise, setPreviewChemise] = useState<ChemiseId>("bleu-classeur");

  useEffect(() => {
    const resolved = resolveTheme(themeMode);
    document.documentElement.dataset.theme = resolved;
  }, [themeMode]);

  return (
    <div className="min-h-screen bg-page text-encre">
      <header className="border-b border-filet bg-classeur px-8 py-6">
        <p className="text-[length:var(--font-size-dense)] text-graphite">
          {fr("LEGAL OS — contrats interface (jalon J0.6)")}
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
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-8">
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

export default App;
