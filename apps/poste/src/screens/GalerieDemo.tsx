import { useMemo, useState } from "react";
import { BarreHaut } from "@/coque/BarreHaut";
import { MenuCompte } from "@/coque/MenuCompte";
import { CHRONO_DEMO } from "@/coque/chrono/donneesDemo";
import { DossierOuvert, DOSSIERS_DEMO } from "@/screens/DossierOuvert";
import { EcranAgenda } from "@/agenda/EcranAgenda";
import { EcranFacturation } from "@/facturation/EcranFacturation";
import { estAClasser } from "@/messagerie/classement";
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
    // Jeu fictif de la maquette prototype-mails, daté d'après un instant fixe pour des captures stables.
    const moi = "demo-utilisateur";
    const boite = "j.marchal@cabinet-marchal.example";
    return {
      maintenant: "2026-10-09T10:00:00+02:00",
      derniereReleve: "2026-10-09T09:59:00+02:00",
      selectionInitiale: "mail-2",
      comptes: [
        { id: "compte-perso", adresse: boite, type_compte: "nominatif", titulaire_id: moi },
        { id: "compte-partage", adresse: "contact@cabinet-marchal.example", type_compte: "partage" },
      ],
      dossiers: [
        { id: "d-tilleuls", nom: "SCI Les Tilleuls", chemise: "kraft", reference: "2026-042" },
        { id: "d-ferrand", nom: "Ferrand Métal", chemise: "bleu-classeur", reference: "2026-031" },
        { id: "d-moreau", nom: "Succession Moreau", chemise: "vert-amande", reference: "2026-057" },
      ],
      file: [
        {
          id: "envoi-1",
          objet: "Conclusions en réplique",
          destinataire: "Me Anne Perrin",
          etat: "copie_envoyes_confirmee",
        },
        {
          id: "envoi-2",
          objet: "Bordereau de pièces",
          destinataire: "Me Lucas Garnier",
          etat: "en_attente",
        },
      ],
      invitations: [
        {
          id: "invitation-1",
          uid_ical: "demo-acte-partage@etude-garnier.example",
          sequence: 0,
          effet: "demande",
          fuseau: "Europe/Paris",
          debut: "2026-10-08T10:00:00",
          fin: "2026-10-08T11:00:00",
          objet: "Signature de l'acte de partage",
          organisateur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
        },
      ],
      corps: {
        "mail-1":
          "Cher Confrère,\n\nJe vous prie de bien vouloir trouver ci-joint communication des pièces n° 14 à 19, dont le bordereau récapitulatif est joint au présent envoi.\n\nBien confraternellement.\n\nClément Vasseur\nAvocat au Barreau de Lyon",
        "mail-2":
          "Maître,\n\nL'affaire enregistrée sous le numéro RG 25/04417 est fixée à l'audience de mise en état du 12 novembre à 9 h 30.\n\nLe greffe",
        "mail-3":
          "Maître,\n\nVoici les deux derniers bons de livraison que vous m'aviez demandés pour l'audience de lundi.\n\nBien cordialement.\n\nInès Ferrand\nDirectrice administrative, SAS Ferrand Métal",
        "mail-4":
          "Maître,\n\nJe vous propose de fixer la signature de l'acte de partage de la succession Moreau au jeudi 8 octobre à 10 h, en présence de Mme Moreau.\n\nBien à vous.",
        "mail-5":
          "Maître,\n\nFaisant suite à nos échanges, nous vous adressons une proposition de protocole d'accord, que nous vous remercions de soumettre à votre cliente.\n\nLe service contentieux",
        "mail-6":
          "Mes chers Confrères,\n\nVous trouverez dans cette lettre le programme de formation continue du trimestre et le calendrier des permanences.",
        "mail-7":
          "Mon cher Confrère,\n\nJe vous prie de trouver ci-joint mes conclusions récapitulatives, notifiées ce jour par RPVA.\n\nBien confraternellement.",
      },
      mails: [
        {
          id: "mail-1",
          objet: "Communication de pièces adverses n° 14 à 19",
          expediteur: "Me Clément Vasseur <c.vasseur@cabinet-vasseur.example>",
          destinataires_texte: boite,
          pieces_texte: "Bordereau n° 4.pdf\nPièce 14, contrat de prêt.pdf\nPièce 15, avenant.pdf",
          debut_texte: "Cher Confrère, je vous prie de bien vouloir trouver ci-joint communication des pièces…",
          etat_classement: "classe",
          dossier_id: "d-tilleuls",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 0,
          dossier_imap: "INBOX",
          cree_le: "2026-10-09T09:12:00+02:00",
        },
        {
          id: "mail-2",
          objet: "Avis de fixation, RG 25/04417",
          expediteur: "Greffe de la cour d'appel de Lyon <greffe.ca-lyon@justice.example>",
          destinataires_texte: boite,
          pieces_texte: "Avis de fixation.pdf",
          debut_texte: "L'affaire est fixée à l'audience de mise en état du 12 novembre à 9 h 30…",
          etat_classement: "suggestion",
          dossier_id: null,
          suggestion_dossier_id: "d-tilleuls",
          titulaire_id: moi,
          lu: 0,
          dossier_imap: "INBOX",
          cree_le: "2026-10-09T08:40:00+02:00",
        },
        {
          id: "mail-3",
          objet: "Re : dossier de plaidoirie",
          expediteur: "Mme Inès Ferrand <i.ferrand@ferrand-metal.example>",
          destinataires_texte: boite,
          pieces_texte: "Bon de livraison 1184.pdf\nBon de livraison 1192.pdf",
          debut_texte: "Maître, voici les deux derniers bons de livraison que vous m'aviez demandés…",
          etat_classement: "classe",
          dossier_id: "d-ferrand",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-09T08:05:00+02:00",
        },
        {
          id: "mail-4",
          objet: "Invitation : signature de l'acte de partage",
          expediteur: "Me Lucas Garnier <l.garnier@etude-garnier.example>",
          destinataires_texte: boite,
          pieces_texte: "",
          debut_texte: "Rendez-vous le jeudi 8 octobre, 10 h à 11 h, à l'étude. Merci de confirmer votre présence.",
          etat_classement: "classe",
          dossier_id: "d-moreau",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-08T17:20:00+02:00",
        },
        {
          id: "mail-5",
          objet: "Proposition de protocole d'accord",
          expediteur: "Banque Rhodanienne, service contentieux <contentieux@banque-rhodanienne.example>",
          destinataires_texte: boite,
          pieces_texte: "Projet de protocole.docx",
          debut_texte: "Maître, faisant suite à nos échanges, nous vous adressons une proposition de protocole…",
          etat_classement: "suggestion",
          dossier_id: null,
          suggestion_dossier_id: "d-tilleuls",
          titulaire_id: moi,
          lu: 0,
          dossier_imap: "INBOX",
          cree_le: "2026-10-08T11:02:00+02:00",
        },
        {
          id: "mail-6",
          objet: "Lettre d'information d'octobre",
          expediteur: "Ordre des avocats de Lyon <communication@barreau-lyon.example>",
          destinataires_texte: "contact@cabinet-marchal.example",
          pieces_texte: "",
          debut_texte: "Formation continue, permanences et calendrier des audiences solennelles…",
          etat_classement: "a_classer",
          dossier_id: null,
          suggestion_dossier_id: null,
          titulaire_id: null,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-05T07:30:00+02:00",
        },
        {
          id: "mail-7",
          objet: "Conclusions récapitulatives",
          expediteur: "Me Anne Perrin <a.perrin@perrin-avocats.example>",
          destinataires_texte: boite,
          pieces_texte: "Conclusions récapitulatives.pdf",
          debut_texte: "Mon cher Confrère, je vous prie de trouver ci-joint mes conclusions récapitulatives…",
          etat_classement: "classe",
          dossier_id: "d-ferrand",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "INBOX",
          cree_le: "2026-10-01T18:42:00+02:00",
        },
        {
          id: "mail-8",
          objet: "Réponse à la proposition de protocole",
          expediteur: boite,
          destinataires_texte: "Banque Rhodanienne, service contentieux <contentieux@banque-rhodanienne.example>",
          pieces_texte: "",
          debut_texte: "Madame, Monsieur, ma cliente accepte le principe d'une transaction…",
          etat_classement: "classe",
          dossier_id: "d-tilleuls",
          suggestion_dossier_id: null,
          titulaire_id: moi,
          lu: 1,
          dossier_imap: "Drafts",
          cree_le: "2026-10-09T09:31:00+02:00",
        },
      ],
    };
  }, []);
  const aClasser = mailsDemo.mails.filter((mail) => estAClasser(mail.etat_classement)).length;
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
              onComposer={() => undefined}
              onSaisirTemps={() => undefined}
              onOuvrirDossier={() => undefined}
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
