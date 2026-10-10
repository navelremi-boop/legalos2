import { useMemo, useState } from "react";
import { BarreHaut } from "@/coque/BarreHaut";
import { MenuCompte } from "@/coque/MenuCompte";
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
  /** Dernière entrée choisie dans le menu du compte (la galerie n'exécute rien), lue par les recettes. */
  const [dernierChoixCompte, setDernierChoixCompte] = useState("");
  const [vue, setVue] = useState<
    "dossier" | "journee" | "dossiers" | "mails" | "agenda" | "facturation" | "reglages"
  >("dossier");

  const mailsDemo = useMemo<DemonstrationMails>(() => {
    const aujourd = new Date().toISOString().slice(0, 10);
    return {
      comptes: [
        { id: "compte-demo", adresse: "avocat@cabinet.example", type_compte: "nominatif" },
      ],
      dossiers: [{ id: "ferrand", nom: "Ferrand Métal", chemise: "kraft" }],
      file: [
        { id: "envoi-1", objet: "Conclusions en réplique", destinataire: "greffe@example.com", etat: "en_attente" },
        { id: "envoi-2", objet: "Bordereau de pièces", destinataire: "confrere@example.com", etat: "copie_envoyes_confirmee" },
      ],
      mails: [
        {
          id: "mail-classe",
          objet: "Pièces du dossier",
          etat_classement: "classe",
          dossier_id: "ferrand",
          suggestion_dossier_id: null,
          expediteur: "tiers@example.com",
          destinataires: "avocat@cabinet.example",
          texte_brut: "Veuillez trouver les pièces communiquées ce jour.",
          cree_le: `${aujourd}T08:30:00`,
          dossier_imap: "INBOX",
          pieces: ["Bordereau.pdf"],
        },
        {
          id: "mail-a-classer",
          objet: "Courrier à ranger",
          etat_classement: "a_classer",
          dossier_id: null,
          suggestion_dossier_id: "ferrand",
          expediteur: "greffe@example.com",
          destinataires: "avocat@cabinet.example",
          texte_brut: "Convocation à l'audience du 12 octobre.",
          cree_le: `${aujourd}T09:15:00`,
          dossier_imap: "INBOX",
          pieces: ["Convocation.pdf"],
        },
        {
          id: "mail-envoye",
          objet: "Note au confrère",
          etat_classement: "classe",
          dossier_id: "ferrand",
          suggestion_dossier_id: null,
          expediteur: "avocat@cabinet.example",
          destinataires: "confrere@example.com",
          texte_brut: "Je vous adresse le projet de protocole.",
          cree_le: `${aujourd}T11:00:00`,
          dossier_imap: "Envoyés",
        },
      ],
    };
  }, []);
  const aClasser = mailsDemo.mails.filter((mail) => mail.etat_classement === "a_classer").length;
  const dossiersDemo = useMemo(
    () => [
      {
        id: "ferrand",
        nom: "Ferrand Métal",
        chemise: "kraft",
        reference: "2026-042",
        type_dossier: "contentieux",
        etape: "instruction",
      },
      {
        id: "lilas",
        nom: "SCI des Lilas",
        chemise: "vert-amande",
        reference: "2026-038",
        type_dossier: "conseil",
        etape: "ouverture",
      },
    ],
    [],
  );
  const agendaDemo = useMemo(() => {
    const base = new Date();
    const iso = (heure: number) => {
      const copie = new Date(base);
      copie.setHours(heure, 0, 0, 0);
      const mois = String(copie.getMonth() + 1).padStart(2, "0");
      const jour = String(copie.getDate()).padStart(2, "0");
      return `${String(copie.getFullYear())}-${mois}-${jour}T${String(heure).padStart(2, "0")}:00:00`;
    };
    return [
      {
        id: "ag-1",
        dossier_id: "ferrand",
        type_element: "audience",
        titre: "Mise en état",
        debut: iso(9),
        rappel_le: null,
        origine_calcul: null,
        jours_calcul: null,
        mois_calcul: null,
        annees_calcul: null,
      },
      {
        id: "ag-2",
        dossier_id: "lilas",
        type_element: "rendez_vous",
        titre: "Rendez-vous client",
        debut: iso(14),
        rappel_le: null,
        origine_calcul: null,
        jours_calcul: null,
        mois_calcul: null,
        annees_calcul: null,
      },
      {
        id: "ag-3",
        dossier_id: "ferrand",
        type_element: "tache",
        titre: "Déposer les conclusions",
        debut: iso(16),
        rappel_le: null,
        origine_calcul: "2026-09-01",
        jours_calcul: 15,
        mois_calcul: 0,
        annees_calcul: 0,
      },
    ];
  }, []);
  const facturesDemo = useMemo(
    () => [
      { id: "f-brouillon", libelle: "Ferrand Métal — temps de septembre", statut: "Brouillon", montant: "1 200,00 €" },
      { id: "f-validee", libelle: "SCI des Lilas — provision", statut: "Validée", montant: "800,00 €" },
      { id: "f-deposee", libelle: "Ferrand Métal — facture 2026-014", statut: "Déposée", montant: "2 400,00 €" },
      { id: "f-encaissee", libelle: "SCI des Lilas — facture 2026-011", statut: "Encaissée", montant: "600,00 €" },
      { id: "f-avoir", libelle: "Avoir sur 2026-011", statut: "Avoir", montant: "−120,00 €" },
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
          mailsCompteur={aClasser}
          compteMenu={
            <MenuCompte
              initiales="JM"
              onTemps={() => {
                setDernierChoixCompte("temps");
              }}
              onReglages={() => {
                setDernierChoixCompte("reglages");
              }}
              onPalette={() => {
                setDernierChoixCompte("palette");
              }}
              onVerrouiller={() => {
                setDernierChoixCompte("verrouiller");
              }}
              onDeconnecter={() => {
                setDernierChoixCompte("deconnexion");
              }}
            />
          }
        />
        <div className="coque-workspace min-h-0 flex-1">
          <span className="sr-only" data-testid="galerie-menu-dernier-choix">
            {dernierChoixCompte}
          </span>
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
              lignesFixes={agendaDemo}
              onNouveauDossier={() => undefined}
              onNouveauMail={() => undefined}
              onSaisirTemps={() => undefined}
            />
          ) : null}
          {vue === "facturation" ? (
            <EcranFacturation
              lignes={facturesDemo}
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
