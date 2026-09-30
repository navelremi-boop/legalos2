import { useMemo, useState } from "react";
import { BarreHaut } from "@/coque/BarreHaut";
import { CHRONO_DEMO } from "@/coque/chrono/donneesDemo";
import { DossierOuvert, DOSSIERS_DEMO } from "@/screens/DossierOuvert";
import { EcranAgenda } from "@/agenda/EcranAgenda";
import { EcranFacturation } from "@/facturation/EcranFacturation";
import { EcranMails, type DemonstrationMails } from "@/messagerie/EcranMails";
import { Dossiers } from "@/screens/Dossiers";
import { Journee } from "@/screens/Journee";
import { Reglages } from "@/screens/Reglages";
import type { ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";

/**
 * Galerie de démonstration — réservée au développement (`import.meta.env.DEV`).
 * Absente des builds distribués. Inclut la barre du haut pour comparer au prototype.
 */
export function GalerieDemo() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [chemise, setChemise] = useState<ChemiseId>("kraft");
  const [vue, setVue] = useState<
    "dossier" | "journee" | "dossiers" | "mails" | "agenda" | "facturation" | "reglages"
  >("dossier");

  const mailsDemo = useMemo<DemonstrationMails>(
    () => ({
      comptes: [
        { id: "compte-demo", adresse: "classement@cabinet.example", type_compte: "classement" },
      ],
      dossiers: [{ id: "ferrand", nom: "Ferrand Métal", chemise: "kraft" }],
      mails: [
        {
          id: "mail-classe",
          objet: "Pièces du dossier",
          etat_classement: "classe",
          dossier_id: "ferrand",
          suggestion_dossier_id: null,
          expediteur: "tiers@example.com",
        },
        {
          id: "mail-a-classer",
          objet: "Courrier à ranger",
          etat_classement: "a_classer",
          dossier_id: null,
          suggestion_dossier_id: "ferrand",
          expediteur: "autre@example.com",
        },
      ],
    }),
    [],
  );
  const dossiersDemo = useMemo(
    () => [
      { id: "ferrand", nom: "Ferrand Métal", chemise: "kraft", reference: "2026-042" },
      { id: "lilas", nom: "SCI des Lilas", chemise: "vert-amande", reference: "2026-038" },
    ],
    [],
  );

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
          {(
            [
              ["dossiers", "Dossiers"],
              ["mails", "Mails"],
              ["agenda", "Agenda"],
              ["facturation", "Facturation"],
              ["reglages", "Réglages"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`px-3 py-1.5 ${vue === id ? "bg-encre font-bold text-feuille" : "text-graphite"}`}
              onClick={() => {
                setVue(id);
              }}
            >
              {fr(label)}
            </button>
          ))}
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
          actif={vue}
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
              elementsChrono={CHRONO_DEMO}
              intercalairesSync={false}
            />
          ) : null}
          {vue === "journee" ? (
            <Journee
              donneesDemo
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "dossiers" ? (
            <Dossiers
              lignesFixes={dossiersDemo}
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "mails" ? (
            <EcranMails
              instanceUrl="http://127.0.0.1:8088"
              demonstration={mailsDemo}
              onNouveauDossier={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "agenda" ? (
            <EcranAgenda
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "facturation" ? (
            <EcranFacturation
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "reglages" ? (
            <Reglages
              themeMode={theme}
              onThemeChange={(mode) => {
                if (mode === "light" || mode === "dark") setTheme(mode);
              }}
              instanceUrl="http://127.0.0.1:8088"
              horsLigne
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
