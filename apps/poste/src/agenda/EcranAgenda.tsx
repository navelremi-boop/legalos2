import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { ecrireElementAgenda, recalculerEcheance, retirerEcheance, type TypeAgenda } from "@/agenda/ecrireAgenda";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { murParis } from "@/agenda/fuseauParis";
import { calculerDelaiComplet } from "@/delais/moteur";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

type Ligne = {
  id: string;
  dossier_id: string;
  type_element: string;
  titre: string;
  debut: string;
  rappel_le: string | null;
  origine_calcul: string | null;
  jours_calcul: number | null;
  mois_calcul: number | null;
  annees_calcul: number | null;
};

function echeanceAttendue(ligne: Ligne): string | null {
  if (!ligne.origine_calcul) return null;
  try {
    return calculerDelaiComplet({
      origine: ligne.origine_calcul,
      jours: ligne.jours_calcul ?? 0,
      mois: ligne.mois_calcul ?? 0,
      annees: ligne.annees_calcul ?? 0,
      siegeJuridiction: "metropole",
      lieuPartie: "metropole",
      typeDelai: { augmentationDistance: "oui" },
    }).echeance;
  } catch {
    return null;
  }
}

const TYPES: TypeAgenda[] = ["audience", "rendez_vous", "tache"];

function champ(form: FormData, nom: string): string {
  const valeur = form.get(nom);
  return typeof valeur === "string" ? valeur.trim() : "";
}

type EcranAgendaProps = {
  onNouveauDossier?: () => void;
  onNouveauMail?: () => void;
  onSaisirTemps?: () => void;
};

export function EcranAgenda({ onNouveauDossier, onNouveauMail, onSaisirTemps }: EcranAgendaProps) {
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [conflit, setConflit] = useState("");

  useEffect(() => {
    const etat = { stop: false };
    const arrete = () => etat.stop;
    const charger = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          database.getAll<Ligne>(
            `SELECT id, dossier_id, type_element, titre, debut, rappel_le,
                    origine_calcul, jours_calcul, mois_calcul, annees_calcul
             FROM agenda_elements ORDER BY debut ASC`,
          ),
        )
        .then(async (rows) => {
          if (arrete()) return;
          setLignes(rows);
          const database = await getPowerSyncDatabase();
          const journaux = await database.getAll<{ valeur_appliquee: string | null }>(
            `SELECT valeur_appliquee FROM journal_modifications
             WHERE table_cible = 'agenda_elements' AND conflit = 1
             ORDER BY cree_le DESC LIMIT 1`,
          );
          if (arrete()) return;
          const premiere = journaux[0];
          setConflit(premiere ? (premiere.valeur_appliquee ?? "") : "");
        })
        .catch(() => {
          if (!arrete()) setLignes([]);
        });
    };
    charger();
    const timer = window.setInterval(charger, 1_500);
    return () => {
      etat.stop = true;
      window.clearInterval(timer);
    };
  }, []);

  async function ajouter(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const typeElement = champ(form, "type_element");
    if (typeElement !== "audience" && typeElement !== "rendez_vous" && typeElement !== "tache") {
      setMessage(fr("Type d'agenda inconnu."));
      return;
    }
    try {
      await ecrireElementAgenda({
        dossierId: champ(form, "dossier_id"),
        typeElement,
        titre: champ(form, "titre"),
        debut: champ(form, "debut"),
        rappelLe: champ(form, "rappel_le"),
      });
      setMessage(fr("Élément inscrit à l'agenda."));
      event.currentTarget.reset();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Enregistrement impossible."));
    }
  }

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]"
      data-testid="ecran-agenda"
      data-fond="neutre"
    >
      <h1 className="mb-4 text-[length:var(--font-size-section)] font-bold">{fr("Agenda")}</h1>
      <Feuille uneColonne className="min-h-[360px]">
      <div className="p-[22px] pb-24">
      <form className="mb-6 max-w-xl" onSubmit={(event) => void ajouter(event)}>
        <select
          id="agenda-type"
          name="type_element"
          data-testid="agenda-type"
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          defaultValue="audience"
        >
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {fr(type === "rendez_vous" ? "rendez-vous" : type === "tache" ? "tâche" : "audience")}
            </option>
          ))}
        </select>
        <input
          id="agenda-dossier"
          name="dossier_id"
          required
          data-testid="agenda-dossier"
          placeholder={fr("Dossier")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          id="agenda-titre"
          name="titre"
          required
          data-testid="agenda-titre"
          placeholder={fr("Titre")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          id="agenda-debut"
          name="debut"
          required
          data-testid="agenda-debut"
          placeholder={fr("Début")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <input
          id="agenda-rappel"
          name="rappel_le"
          data-testid="agenda-rappel"
          placeholder={fr("Rappel")}
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        />
        <button
          type="submit"
          data-testid="agenda-ajouter"
          className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        >
          {fr("Ajouter")}
        </button>
        <p className="mt-2 text-[length:var(--font-size-meta)] text-graphite" data-testid="agenda-message">
          {message}
        </p>
      </form>
      {conflit !== "" ? (
        <p data-testid="agenda-conflit" role="status">
          {fr(`Conflit d'agenda : « ${conflit} ».`)}
        </p>
      ) : null}
      <ul data-testid="agenda-liste">
        {lignes.map((ligne) => {
          const attendue = echeanceAttendue(ligne);
          const mur = murParis(ligne.debut);
          const perimee = attendue !== null && mur.jour !== attendue;
          return (
            <li
              key={ligne.id}
              data-testid="agenda-element"
              data-type={ligne.type_element}
              data-dossier-id={ligne.dossier_id}
            >
              {fr(`${ligne.type_element} — ${ligne.titre} — ${mur.jour} ${mur.heure}:${mur.minute}`)}
              {perimee ? (
                <span data-testid="echeance-perimee">{fr(` périmée, attendu ${attendue}`)}</span>
              ) : null}
              {ligne.origine_calcul ? (
                <>
                  <input
                    id={`echeance-origine-${ligne.id}`}
                    data-testid="echeance-origine"
                    defaultValue={ligne.origine_calcul}
                  />
                  <button
                    type="button"
                    data-testid="echeance-recalculer"
                    onClick={() => {
                      const champOrigine = document.getElementById(
                        `echeance-origine-${ligne.id}`,
                      );
                      const valeur =
                        champOrigine instanceof HTMLInputElement ? champOrigine.value : "";
                      void recalculerEcheance(ligne.id, valeur).catch(() => undefined);
                    }}
                  >
                    {fr("Recalculer")}
                  </button>
                  {confirmation === ligne.id ? (
                    <button
                      type="button"
                      data-testid="echeance-confirmer"
                      onClick={() => {
                        void retirerEcheance(ligne.id).then(() => {
                          setConfirmation("");
                        });
                      }}
                    >
                      {fr("Confirmer la suppression")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="echeance-supprimer"
                      onClick={() => {
                        setConfirmation(ligne.id);
                      }}
                    >
                      {fr("Supprimer")}
                    </button>
                  )}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      </div>
      </Feuille>
      <BarreActions
        actions={[
          {
            id: "nouveau-dossier",
            label: "Nouveau dossier",
            onClick: () => {
              onNouveauDossier?.();
            },
          },
          {
            id: "nouveau-mail",
            label: "Nouveau mail",
            onClick: () => {
              onNouveauMail?.();
            },
          },
          {
            id: "saisir-temps",
            label: "Saisir du temps",
            primaire: true,
            onClick: () => {
              onSaisirTemps?.();
            },
          },
        ]}
      />
    </div>
  );
}
