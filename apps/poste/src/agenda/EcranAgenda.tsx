import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { ecrireElementAgenda, recalculerEcheance, retirerEcheance, type TypeAgenda } from "@/agenda/ecrireAgenda";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { composantesAffichees } from "@/agenda/fuseauParis";
import { calculerDelaiComplet } from "@/delais/moteur";
import { formatDateCourte, formatDateLongue, formatHeureMur } from "@/lib/format";
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

const LIBELLES_TYPE: Record<string, string> = {
  audience: "Audience",
  rendez_vous: "Rendez-vous",
  tache: "Tâche",
};

const DELAIS_RAPPEL = [
  { id: "0", libelle: "Au moment de l'élément" },
  { id: "15", libelle: "15 minutes avant" },
  { id: "60", libelle: "1 heure avant" },
  { id: "1440", libelle: "1 jour avant" },
  { id: "10080", libelle: "1 semaine avant" },
];

function jourCivil(date: Date): string {
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${mois}-${jour}`;
}

function semaineCourante(): string[] {
  const maintenant = new Date();
  const decalage = (maintenant.getDay() + 6) % 7;
  const lundi = new Date(maintenant);
  lundi.setDate(maintenant.getDate() - decalage);
  return Array.from({ length: 7 }, (_, index) => {
    const jour = new Date(lundi);
    jour.setDate(lundi.getDate() + index);
    return jourCivil(jour);
  });
}

type EcranAgendaProps = {
  onNouveauDossier?: () => void;
  onNouveauMail?: () => void;
  onSaisirTemps?: () => void;
  /** Galerie : pas de PowerSync. */
  lignesFixes?: Ligne[];
};

export function EcranAgenda({
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
  lignesFixes,
}: EcranAgendaProps) {
  const [lignesSync, setLignesSync] = useState<Ligne[]>([]);
  const lignes = lignesFixes ?? lignesSync;
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [conflit, setConflit] = useState("");
  const [creation, setCreation] = useState(false);
  const [vue, setVue] = useState<"jour" | "semaine">("jour");

  useEffect(() => {
    if (lignesFixes) return;
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
          setLignesSync(rows);
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
          if (!arrete()) setLignesSync([]);
        });
    };
    charger();
    const timer = window.setInterval(charger, 1_500);
    return () => {
      etat.stop = true;
      window.clearInterval(timer);
    };
  }, [lignesFixes]);

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
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-texte-sur-neutre">
        {fr("Agenda")}
      </h1>
      <Feuille uneColonne className="min-h-[360px]">
      <div className="p-[22px] pb-24">
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className="rounded-[var(--radius-control)] border border-filet px-3 py-1"
          data-testid="agenda-vue-jour"
          aria-pressed={vue === "jour"}
          onClick={() => {
            setVue("jour");
          }}
        >
          {fr("Jour")}
        </button>
        <button
          type="button"
          className="rounded-[var(--radius-control)] border border-filet px-3 py-1"
          data-testid="agenda-vue-semaine"
          aria-pressed={vue === "semaine"}
          onClick={() => {
            setVue("semaine");
          }}
        >
          {fr("Semaine")}
        </button>
        <button
          type="button"
          className="rounded-[var(--radius-control)] border border-filet px-3 py-1"
          data-testid="agenda-creer"
          onClick={() => {
            setCreation(true);
          }}
        >
          {fr("Nouvel élément")}
        </button>
      </div>
      <form className={creation ? "mb-6 max-w-xl" : "hidden"} onSubmit={(event) => void ajouter(event)}>
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
        <div className="mb-2 flex gap-2">
          <input
            type="date"
            data-testid="agenda-date"
            aria-label={fr("Date")}
            className="w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            onChange={(event) => {
              const heure = document.getElementById("agenda-heure");
              const debut = document.getElementById("agenda-debut");
              const h = heure instanceof HTMLInputElement && heure.value !== "" ? heure.value : "09:00";
              if (debut instanceof HTMLInputElement && event.target.value !== "") {
                debut.value = `${event.target.value}T${h}:00`;
              }
            }}
          />
          <input
            id="agenda-heure"
            type="time"
            data-testid="agenda-heure"
            aria-label={fr("Heure")}
            className="w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            onChange={(event) => {
              const date = document.querySelector("[data-testid=agenda-date]");
              const debut = document.getElementById("agenda-debut");
              const jour = date instanceof HTMLInputElement ? date.value : "";
              if (debut instanceof HTMLInputElement && jour !== "" && event.target.value !== "") {
                debut.value = `${jour}T${event.target.value}:00`;
              }
            }}
          />
        </div>
        <input id="agenda-debut" name="debut" required data-testid="agenda-debut" className="hidden" />
        <label className="mb-1 block text-[length:var(--font-size-dense)] text-graphite" htmlFor="agenda-rappel-liste">
          {fr("Rappel")}
        </label>
        <select
          id="agenda-rappel-liste"
          data-testid="agenda-rappel-liste"
          className="mb-2 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          defaultValue="60"
          onChange={(event) => {
            const rappel = document.getElementById("agenda-rappel");
            const choisi = DELAIS_RAPPEL.find((delai) => delai.id === event.target.value);
            if (rappel instanceof HTMLInputElement) rappel.value = choisi?.libelle ?? "";
          }}
        >
          {DELAIS_RAPPEL.map((delai) => (
            <option key={delai.id} value={delai.id}>
              {fr(delai.libelle)}
            </option>
          ))}
        </select>
        <input id="agenda-rappel" name="rappel_le" data-testid="agenda-rappel" className="hidden" />
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
      <div data-testid={vue === "jour" ? "agenda-vue-jour-contenu" : "agenda-vue-semaine-contenu"}>
        {(vue === "jour" ? [jourCivil(new Date())] : semaineCourante()).map((jour) => {
          const duJour = lignes.filter((ligne) => composantesAffichees(ligne.debut)?.jour === jour);
          return (
            <section key={jour} className="mb-3" data-testid="agenda-jour" data-jour={jour}>
              <h2 className="text-[length:var(--font-size-dense)] font-extrabold">{formatDateLongue(jour)}</h2>
              {duJour.length === 0 ? (
                <p className="text-graphite">{fr("Rien ce jour-là.")}</p>
              ) : (
                <ul>
                  {duJour.map((ligne) => {
                    const quand = composantesAffichees(ligne.debut);
                    const heure =
                      quand !== null && quand.heure !== null && quand.minute !== null
                        ? formatHeureMur(quand.heure, quand.minute)
                        : "";
                    return (
                      <li key={ligne.id} className="flex items-baseline justify-between gap-3">
                        {fr(
                          `${LIBELLES_TYPE[ligne.type_element] ?? ligne.type_element} — ${ligne.titre}${ligne.origine_calcul ? " — échéance" : ""}`,
                        )}
                        {heure !== "" ? <span data-testid="agenda-element-heure">{heure}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <ul data-testid="agenda-liste" className="sr-only">
        {lignes.map((ligne) => {
          const attendue = echeanceAttendue(ligne);
          const mur = composantesAffichees(ligne.debut);
          const perimee = attendue !== null && mur !== null && mur.jour !== attendue;
          const quand =
            mur === null
              ? ""
              : `${formatDateCourte(mur.jour)}${
                  mur.heure !== null && mur.minute !== null
                    ? ` ${formatHeureMur(mur.heure, mur.minute)}`
                    : ""
                }`;
          return (
            <li
              key={ligne.id}
              data-testid="agenda-element"
              data-type={ligne.type_element}
              data-dossier-id={ligne.dossier_id}
            >
              {fr(`${ligne.type_element} — ${ligne.titre} — ${quand}`)}
              {perimee ? (
                <span data-testid="echeance-perimee">
                  {fr(` périmée, attendu ${formatDateCourte(attendue)}`)}
                </span>
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
            onClick: () => {
              onSaisirTemps?.();
            },
          },
        ]}
      />
    </div>
  );
}
