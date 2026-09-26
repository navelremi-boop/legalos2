import { useMemo, useState } from "react";
import { BarreHaut } from "@/coque/BarreHaut";
import { DossierOuvert, DOSSIERS_DEMO } from "@/screens/DossierOuvert";
import { Journee } from "@/screens/Journee";
import type { ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";

/**
 * Galerie de démonstration — réservée au développement (`import.meta.env.DEV`).
 * Absente des builds distribués. Inclut la barre du haut pour comparer au prototype.
 */
export function GalerieDemo() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [chemise, setChemise] = useState<ChemiseId>("kraft");
  const [vue, setVue] = useState<"dossier" | "journee">("dossier");

  const premier = DOSSIERS_DEMO[0];
  const dossier =
    DOSSIERS_DEMO.find((d) => d.chemise === chemise) ??
    (premier === undefined
      ? {
          id: "demo",
          reference: "2026-042",
          nom: "Ferrand Métal",
          chemise,
          juridiction: "TJ Nanterre",
          numeroRg: "24/03812",
          client: "SAS Ferrand Métal",
          adversaire: "Sté Dupuis Outillage",
        }
      : { ...premier, chemise });

  const onglets = useMemo(
    () =>
      DOSSIERS_DEMO.map((d) => ({
        id: d.id,
        reference: d.reference,
        nom: d.nom,
        chemise: d.chemise,
      })),
    [],
  );

  return (
    <div className="min-h-screen bg-page p-6" data-testid="galerie-demo">
      <header
        className="mb-4 flex flex-wrap items-center gap-3"
        data-testid="galerie-commandes"
      >
        <h1 className="text-[length:var(--font-size-section)] font-extrabold text-encre">
          {fr("Galerie de démonstration")}
        </h1>
        <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-filet bg-feuille">
          <button
            type="button"
            className={`px-3 py-1.5 ${theme === "light" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            aria-pressed={theme === "light"}
            onClick={() => {
              setTheme("light");
              document.documentElement.dataset.theme = "light";
            }}
          >
            {fr("Jour")}
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 ${theme === "dark" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            aria-pressed={theme === "dark"}
            onClick={() => {
              setTheme("dark");
              document.documentElement.dataset.theme = "dark";
            }}
          >
            {fr("Nuit")}
          </button>
        </div>
        <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-filet bg-feuille">
          <button
            type="button"
            className={`px-3 py-1.5 ${vue === "dossier" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            onClick={() => {
              setVue("dossier");
            }}
          >
            {fr("Dossier")}
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 ${vue === "journee" ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
            onClick={() => {
              setVue("journee");
            }}
          >
            {fr("La journée")}
          </button>
        </div>
        {vue === "dossier"
          ? (["kraft", "bleu-classeur", "vert-amande"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`rounded-[var(--radius-control)] border border-filet px-3 py-1.5 ${
                  chemise === id ? "bg-encre font-bold text-feuille" : "bg-feuille text-graphite"
                }`}
                data-chemise={id}
                onClick={() => {
                  setChemise(id);
                }}
              >
                {fr(id.replace(/-/g, " "))}
              </button>
            ))
          : null}
      </header>

      <div
        className="coque-app mx-auto h-[800px] max-w-[1240px] overflow-hidden rounded-[14px]"
        data-testid="galerie-scene"
        data-theme-capture={theme}
        data-chemise-capture={vue === "dossier" ? chemise : "neutre"}
      >
        <BarreHaut
          actif={vue === "dossier" ? "dossier" : "journee"}
          onNaviguer={() => undefined}
          onglets={vue === "dossier" ? onglets : []}
          ongletActifId={vue === "dossier" ? dossier.id : null}
          sync={{ kind: "synchronise" }}
          chronoSecondes={vue === "dossier" ? 12 * 60 + 4 : undefined}
          onChrono={vue === "dossier" ? () => undefined : undefined}
          onPalette={() => undefined}
          mailsCompteur={3}
        />
        <div className="coque-workspace min-h-0 flex-1">
          {vue === "dossier" ? (
            <DossierOuvert
              dossier={dossier}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
              onFacturer={() => undefined}
              onCalculerDelai={() => undefined}
            />
          ) : (
            <Journee
              donneesDemo
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
