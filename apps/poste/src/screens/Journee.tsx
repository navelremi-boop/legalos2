import { useEffect, useState } from "react";
import { Feuille } from "@/coque/Feuille";
import { BarreActions } from "@/coque/BarreActions";
import { composantesAffichees } from "@/agenda/fuseauParis";
import { jourCivil } from "@/agenda/navigationAgenda";
import { classerMessage } from "@/messagerie/apiMessagerie";
import { CONDITION_SQL_A_CLASSER } from "@/messagerie/classement";
import { propositionTemps } from "@/messagerie/tempsMail";
import { isChemiseId, type ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";
import { ligneDelai, ligneMail, ligneTemps } from "@/screens/assemblerJournee";

export type LigneJournee = {
  id: string;
  titre: string;
  meta: string;
  dossier?: { nom: string; chemise: ChemiseId };
  urgent?: boolean;
  calcule?: boolean;
  classer?: { messageId: string; dossierId: string };
  saisir?: { minutes: number };
};

export type DonneesJournee = {
  audiences: LigneJournee[];
  delais: LigneJournee[];
  mails: LigneJournee[];
  temps: LigneJournee[];
};

/** Jeu fictif pour DEV / galerie / captures B9 (§ 7.6). */
export const JOURNEE_DEMO: DonneesJournee = {
  audiences: [
    {
      id: "aud-1",
      titre: "Audience de mise en état",
      meta: "TJ Nanterre, 9 h 30",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
    },
    {
      id: "aud-2",
      titre: "Rendez-vous client",
      meta: "Cabinet, 14 h 00",
      dossier: { nom: "SCI des Lilas", chemise: "vert-amande" },
    },
  ],
  delais: [
    {
      id: "del-1",
      titre: "Conclusions adverses",
      meta: "échéance le 3 oct., dans 5 jours",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
      urgent: false,
    },
    {
      id: "del-2",
      titre: "Appel incident",
      meta: "échéance le 29 sept., dans 2 jours",
      dossier: { nom: "Martin / Assurances Loire", chemise: "bleu-classeur" },
      urgent: true,
    },
  ],
  mails: [
    {
      id: "mail-1",
      titre: "Me Dupont — pièces jointes",
      meta: "Suggéré : Ferrand Métal",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
    },
    {
      id: "mail-2",
      titre: "Assurances Loire — mise en demeure",
      meta: "Suggéré : Martin / Assurances Loire",
      dossier: { nom: "Martin / Assurances Loire", chemise: "bleu-classeur" },
    },
  ],
  temps: [
    {
      id: "tps-1",
      titre: "Préparation audience",
      meta: "0 h 45, brouillon",
      dossier: { nom: "Ferrand Métal", chemise: "kraft" },
    },
    {
      id: "tps-2",
      titre: "Entretien téléphonique",
      meta: "0 h 20, brouillon",
      dossier: { nom: "SCI des Lilas", chemise: "vert-amande" },
    },
  ],
};

type JourneeProps = {
  onNouveauDossier: () => void;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
  /** Affiche le jeu fictif (galerie). Sans cela, les quatre sections viennent de la base locale. */
  donneesDemo?: boolean;
  donnees?: DonneesJournee;
  instanceUrl?: string;
};

function Pastille({ chemise }: { chemise: ChemiseId }) {
  return (
    <span
      className="ligne-journee__pastille"
      data-testid="pastille-dossier"
      data-chemise={chemise}
      aria-hidden
    />
  );
}

function Section({
  id,
  titre,
  lignes,
  vide,
  onClasser,
  onSaisir,
}: {
  id: string;
  titre: string;
  lignes: LigneJournee[];
  vide: string;
  onClasser?: (messageId: string, dossierId: string) => void;
  onSaisir?: () => void;
}) {
  return (
    <section data-testid={`section-${id}`}>
      <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
        {fr(titre)}
      </h2>
      {lignes.length === 0 ? (
        <p className="text-graphite">{fr(vide)}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lignes.map((ligne) => (
            <li
              key={ligne.id}
              className={`ligne-journee${ligne.urgent ? " ligne-journee--urgent" : ""}`}
            >
              {ligne.dossier ? <Pastille chemise={ligne.dossier.chemise} /> : null}
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{fr(ligne.titre)}</div>
                <div className="truncate text-[length:var(--font-size-dense)] text-graphite">
                  {fr(ligne.meta)}
                  {ligne.calcule ? (
                    <span className="ml-2 font-bold text-encre" data-testid="journee-calcule">
                      {fr("Calculé")}
                    </span>
                  ) : null}
                </div>
              </div>
              {ligne.classer ? (
                <button
                  type="button"
                  className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                  data-testid="journee-classer"
                  onClick={() => {
                    onClasser?.(ligne.classer?.messageId ?? "", ligne.classer?.dossierId ?? "");
                  }}
                >
                  {fr("Classer")}
                </button>
              ) : null}
              {ligne.saisir ? (
                <button
                  type="button"
                  className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                  data-testid="journee-saisir"
                  onClick={() => {
                    onSaisir?.();
                  }}
                >
                  {fr(ligne.saisir.minutes > 0 ? `Saisir ${String(ligne.saisir.minutes)} min` : "Saisir")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Journee({
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
  donneesDemo,
  donnees,
  instanceUrl,
}: JourneeProps) {
  const fixe = donnees ?? (donneesDemo ? JOURNEE_DEMO : null);
  const [reelles, setReelles] = useState<DonneesJournee | null>(null);
  const jeu = fixe ?? reelles;
  const audiences = jeu?.audiences ?? [];
  const delais = jeu?.delais ?? [];
  const mails = jeu?.mails ?? [];
  const temps = jeu?.temps ?? [];

  useEffect(() => {
    if (fixe) return;
    let stop = false;
    const charger = () => {
      const aujourd = jourCivil(new Date());
      void getPowerSyncDatabase()
        .then(async (database) => {
          const [agendas, dossiers, aClasser, classes] = await Promise.all([
            database.getAll<{
              id: string;
              titre: string;
              type_element: string;
              debut: string;
              origine_calcul: string | null;
              dossier_id: string;
            }>(
              "SELECT id, titre, type_element, debut, origine_calcul, dossier_id FROM agenda_elements",
            ),
            database.getAll<{ id: string; nom: string; chemise: string }>(
              "SELECT id, nom, chemise FROM dossiers",
            ),
            database.getAll<{
              id: string;
              objet: string | null;
              expediteur: string | null;
              suggestion_dossier_id: string | null;
            }>(
              `SELECT id, objet, expediteur, suggestion_dossier_id FROM messages
               WHERE ${CONDITION_SQL_A_CLASSER} LIMIT 8`,
            ),
            database.getAll<{ id: string; dossier_id: string }>(
              "SELECT id, dossier_id FROM messages WHERE etat_classement = 'classe' AND dossier_id IS NOT NULL LIMIT 5",
            ),
          ]);
          const parId = new Map(dossiers.map((dossier) => [dossier.id, dossier]));
          const chemiseDe = (id: string) => {
            const dossier = parId.get(id);
            if (!dossier || !isChemiseId(dossier.chemise)) return undefined;
            return { nom: dossier.nom, chemise: dossier.chemise };
          };
          const duJour = agendas.filter((ligne) => {
            const quand = composantesAffichees(ligne.debut);
            return (
              quand?.jour === aujourd &&
              (ligne.type_element === "audience" ||
                ligne.type_element === "rendez_vous" ||
                ligne.type_element === "tache")
            );
          });
          const proposition = propositionTemps([]);
          return {
            audiences: duJour.map((ligne) => {
              const dossier = chemiseDe(ligne.dossier_id);
              return {
                id: ligne.id,
                titre: ligne.titre,
                meta: "",
                dossier: dossier ? { nom: dossier.nom, chemise: dossier.chemise } : undefined,
              };
            }),
            delais: agendas
              .filter((ligne) => {
                if (!ligne.origine_calcul) return false;
                const quand = composantesAffichees(ligne.debut);
                return quand !== null && quand.jour >= aujourd;
              })
              .slice(0, 4)
              .map((ligne) => {
                const dossier = chemiseDe(ligne.dossier_id);
                return ligneDelai({
                  id: ligne.id,
                  titre: ligne.titre,
                  origineCalcul: ligne.origine_calcul,
                  dossierNom: dossier?.nom,
                  chemise: dossier?.chemise,
                });
              }),
            mails: aClasser.map((ligne) => {
              const suggere = ligne.suggestion_dossier_id;
              const dossier = suggere ? chemiseDe(suggere) : undefined;
              return ligneMail({
                id: ligne.id,
                objet: ligne.objet ?? "",
                expediteur: ligne.expediteur ?? "",
                suggestionDossierId: suggere,
                dossierNom: dossier?.nom,
                chemise: dossier?.chemise,
              });
            }),
            temps: [
              ...classes.map((ligne) => {
                const dossier = chemiseDe(ligne.dossier_id);
                return ligneTemps({
                  id: ligne.id,
                  libelle: proposition.libelle,
                  minutes: proposition.minutes,
                  origine: "mail",
                  dossierNom: dossier?.nom,
                  chemise: dossier?.chemise,
                });
              }),
              ...duJour
                .filter((ligne) => ligne.type_element === "tache")
                .map((ligne) => {
                  const dossier = chemiseDe(ligne.dossier_id);
                  return ligneTemps({
                    id: `agenda-${ligne.id}`,
                    libelle: ligne.titre,
                    minutes: 0,
                    origine: "agenda",
                    dossierNom: dossier?.nom,
                    chemise: dossier?.chemise,
                  });
                }),
            ],
          } satisfies DonneesJournee;
        })
        .then((suivant) => {
          if (!stop) setReelles(suivant);
        })
        .catch(() => {
          if (!stop) setReelles({ audiences: [], delais: [], mails: [], temps: [] });
        });
    };
    charger();
    const timer = window.setInterval(charger, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [fixe]);

  function classer(messageId: string, dossierId: string) {
    if (!instanceUrl || messageId === "" || dossierId === "") return;
    void classerMessage(instanceUrl, messageId, dossierId).then(() => {
      setReelles((actuel) =>
        actuel ? { ...actuel, mails: actuel.mails.filter((ligne) => ligne.id !== messageId) } : actuel,
      );
    });
  }

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[30px] pt-[28px] pb-0"
      data-testid="ecran-journee"
      data-fond="neutre"
    >
      <div className="sr-only" data-testid="fond-neutre">
        {fr("Fond neutre")}
      </div>
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-texte-sur-neutre">
        {fr("La journée")}
      </h1>
      <Feuille uneColonne className="min-h-[420px]">
        <div className="grid gap-8 p-[22px] pb-24 md:grid-cols-2">
          <Section
            id="audiences"
            titre="Audiences et rendez-vous du jour"
            lignes={audiences}
            vide="Aucune audience ni rendez-vous aujourd'hui."
          />
          <Section
            id="delais"
            titre="Délais"
            lignes={delais}
            vide="Aucun délai à surveiller pour le moment."
          />
          <Section
            id="mails"
            titre="Mails à classer"
            lignes={mails}
            vide="Aucun mail en attente de classement."
            onClasser={classer}
          />
          <Section
            id="temps"
            titre="Temps à saisir"
            lignes={temps}
            vide="Aucun temps en attente de saisie."
            onSaisir={onSaisirTemps}
          />
        </div>
      </Feuille>
      <BarreActions
        actions={[
          { id: "nouveau-dossier", label: "Nouveau dossier", primaire: true, onClick: onNouveauDossier },
          { id: "nouveau-mail", label: "Nouveau mail", onClick: onNouveauMail },
          { id: "saisir-temps", label: "Saisir du temps", raccourci: "T", onClick: onSaisirTemps },
        ]}
      />
    </div>
  );
}
