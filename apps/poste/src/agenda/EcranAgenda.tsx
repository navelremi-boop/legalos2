import { useEffect, useMemo, useState } from "react";
import type { SubmitEvent } from "react";
import { ecrireElementAgenda, recalculerEcheance, retirerEcheance, type TypeAgenda } from "@/agenda/ecrireAgenda";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { lireInvitations } from "@/agenda/donneesInvitations";
import { composantesAffichees } from "@/agenda/fuseauParis";
import {
  elementsInvitations,
  invitationsDuJour,
  presenterInvitationAgenda,
} from "@/agenda/invitationsAgenda";
import {
  categorieAgenda,
  CATEGORIES_AGENDA,
  GRILLE_DEBUT,
  GRILLE_FIN,
  HAUTEUR_HEURE,
  placerSimultanes,
  positionGrille,
  prochainesEcheances,
  type CategorieAgenda,
} from "@/agenda/dispositionAgenda";
import { decalerJour, debutMois, grilleMois, jourCivil, libelleMois, semaineDe } from "@/agenda/navigationAgenda";
import { calculerDelaiComplet } from "@/delais/moteur";
import { formatDateCourte, formatDateLongue, formatHeureMur } from "@/lib/format";
import { fr } from "@/lib/fr";
import type { InvitationLocale } from "@/messagerie/typesMails";
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
  echeance: "Échéances",
};

const DUREE_AFFICHEE_MINUTES = 60;

const DELAIS_RAPPEL = [
  { id: "0", libelle: "Au moment de l'élément" },
  { id: "15", libelle: "15 minutes avant" },
  { id: "60", libelle: "1 heure avant" },
  { id: "1440", libelle: "1 jour avant" },
  { id: "10080", libelle: "1 semaine avant" },
];

type EcranAgendaProps = {
  onNouveauDossier?: () => void;
  onNouveauMail?: () => void;
  onSaisirTemps?: () => void;
  /** Ouvre l'écran Mails sur le message dont l'en-tête Message-ID est donné (lien « Ouvrir le mail » d'une invitation). */
  onOuvrirMail?: (messageId: string) => void;
  /** Galerie : pas de PowerSync. */
  lignesFixes?: Ligne[];
  invitationsFixes?: InvitationLocale[];
};

export function EcranAgenda({
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
  onOuvrirMail,
  lignesFixes,
  invitationsFixes,
}: EcranAgendaProps) {
  const [lignesSync, setLignesSync] = useState<Ligne[]>([]);
  const lignes = lignesFixes ?? lignesSync;
  const [invitationsSync, setInvitationsSync] = useState<InvitationLocale[]>([]);
  const invitations = invitationsFixes ?? invitationsSync;
  const elementsInvit = useMemo(() => elementsInvitations(invitations), [invitations]);
  /** Jour de repère de la vue ; `null` : aujourd'hui, qui suit l'horloge. */
  const [ancre, setAncre] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [conflit, setConflit] = useState("");
  const [creation, setCreation] = useState(false);
  const [vue, setVue] = useState<"jour" | "semaine">("jour");
  const [filtres, setFiltres] = useState<Record<CategorieAgenda, boolean>>({
    audience: true,
    rendez_vous: true,
    tache: true,
    echeance: true,
  });
  const [moisAffiche, setMoisAffiche] = useState<string | null>(null);
  const [calculOuvert, setCalculOuvert] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    if (invitationsFixes) return;
    const etat = { stop: false };
    const charger = () => {
      void getPowerSyncDatabase()
        .then((database) => lireInvitations(database))
        .then((lues) => {
          if (etat.stop) return;
          setInvitationsSync((actuelles) => (JSON.stringify(actuelles) === JSON.stringify(lues) ? actuelles : lues));
        })
        .catch(() => {
          if (!etat.stop) setInvitationsSync([]);
        });
    };
    charger();
    const timer = window.setInterval(charger, 1_500);
    return () => {
      etat.stop = true;
      window.clearInterval(timer);
    };
  }, [invitationsFixes]);

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

  const jourRepere = ancre ?? jourCivil(new Date());
  const mois = moisAffiche ?? debutMois(jourRepere);
  const casesMois = grilleMois(mois);
  const lignesVisibles = lignes.filter((ligne) => filtres[categorieAgenda(ligne.type_element, ligne.origine_calcul)]);
  const choisi = lignesVisibles.find((ligne) => ligne.id === selection) ?? lignesVisibles[0] ?? null;
  const prochaines = prochainesEcheances(
    lignesVisibles.flatMap((ligne) => {
      const quand = composantesAffichees(ligne.debut);
      if (!quand) return [];
      return [
        {
          id: ligne.id,
          jour: quand.jour,
          debutMinute: (quand.heure ?? 0) * 60 + (quand.minute ?? 0),
          titre: ligne.titre,
          origine: ligne.origine_calcul,
        },
      ];
    }),
    jourCivil(new Date()),
  );

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[30px] pt-[28px]"
      data-testid="ecran-agenda"
      data-fond="neutre"
    >
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-texte-sur-neutre">
        {fr("Agenda")}
      </h1>
      <Feuille className="min-h-[360px]">
      <aside className="min-h-0 overflow-y-auto border-r border-filet p-[22px]">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-extrabold">{fr(libelleMois(mois))}</p>
          <span className="flex gap-1">
            <button
              type="button"
              className="rounded-[var(--radius-control)] border border-filet px-2 py-1"
              aria-label={fr("Mois précédent")}
              data-testid="agenda-mini-precedent"
              onClick={() => {
                setMoisAffiche(decalerJour(debutMois(mois), -1).slice(0, 7) + "-01");
              }}
            >
              {fr("Précédent")}
            </button>
            <button
              type="button"
              className="rounded-[var(--radius-control)] border border-filet px-2 py-1"
              aria-label={fr("Mois suivant")}
              data-testid="agenda-mini-suivant"
              onClick={() => {
                setMoisAffiche(decalerJour(`${mois.slice(0, 7)}-28`, 7).slice(0, 7) + "-01");
              }}
            >
              {fr("Suivant")}
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 gap-px text-center" data-testid="agenda-mini">
          {casesMois.map((cellule) => (
            <button
              key={cellule.jour}
              type="button"
              className="rounded-[var(--radius-control)] px-0 py-1 text-[length:var(--font-size-dense)]"
              data-testid="agenda-mini-jour"
              data-jour={cellule.jour}
              data-dans-mois={cellule.dansMois ? "true" : "false"}
              aria-pressed={cellule.jour === jourRepere}
              onClick={() => {
                setAncre(cellule.jour);
                setMoisAffiche(debutMois(cellule.jour));
              }}
            >
              {cellule.jour.slice(8)}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-1" role="group" aria-label={fr("Types d'éléments")}>
          {CATEGORIES_AGENDA.map((categorie) => {
            const compte = lignes.filter(
              (ligne) => categorieAgenda(ligne.type_element, ligne.origine_calcul) === categorie,
            ).length;
            return (
              <button
                key={categorie}
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                aria-pressed={filtres[categorie]}
                data-testid={`agenda-filtre-${categorie}`}
                onClick={() => {
                  setFiltres((actuel) => ({ ...actuel, [categorie]: !actuel[categorie] }));
                }}
              >
                {fr(LIBELLES_TYPE[categorie] ?? categorie)} <b>{compte}</b>
              </button>
            );
          })}
        </div>
        <h2 className="mb-2 mt-4 text-[length:var(--font-size-section)] font-extrabold">
          {fr("Prochaines échéances")}
        </h2>
        <ul data-testid="agenda-prochaines">
          {prochaines.length === 0 ? (
            <li className="text-graphite">{fr("Aucune échéance à venir.")}</li>
          ) : (
            prochaines.map((ligne) => (
              <li key={ligne.id}>
                <button
                  type="button"
                  className="w-full py-1 text-left"
                  onClick={() => {
                    setAncre(ligne.jour);
                  }}
                >
                  {fr(`${formatDateCourte(ligne.jour)} — ${ligne.titre}`)}
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
      <div className="min-h-0 overflow-y-auto p-[22px] pb-24">
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
          data-testid="agenda-precedent"
          onClick={() => {
            setAncre(decalerJour(ancre ?? jourCivil(new Date()), vue === "jour" ? -1 : -7));
          }}
        >
          {fr(vue === "jour" ? "Jour précédent" : "Semaine précédente")}
        </button>
        <button
          type="button"
          className="rounded-[var(--radius-control)] border border-filet px-3 py-1"
          data-testid="agenda-aujourdhui"
          onClick={() => {
            setAncre(null);
          }}
        >
          {fr("Aujourd'hui")}
        </button>
        <button
          type="button"
          className="rounded-[var(--radius-control)] border border-filet px-3 py-1"
          data-testid="agenda-suivant"
          onClick={() => {
            setAncre(decalerJour(ancre ?? jourCivil(new Date()), vue === "jour" ? 1 : 7));
          }}
        >
          {fr(vue === "jour" ? "Jour suivant" : "Semaine suivante")}
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
      <form
        className={creation ? "mb-6 max-w-xl rounded-[var(--radius-control)] border border-filet p-3" : "hidden"}
        data-testid="agenda-panneau-creation"
        hidden={!creation}
        onSubmit={(event) => void ajouter(event)}
      >
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
        {(vue === "jour" ? [jourRepere] : semaineDe(jourRepere)).map((jour) => {
          const duJour = lignesVisibles.filter((ligne) => composantesAffichees(ligne.debut)?.jour === jour);
          const minutes = (ligne: Ligne) => {
            const quand = composantesAffichees(ligne.debut);
            if (!quand || quand.heure === null || quand.minute === null) return null;
            return quand.heure * 60 + quand.minute;
          };
          const places = placerSimultanes(
            duJour.flatMap((ligne) => {
              const debutMinute = minutes(ligne);
              if (debutMinute === null) return [];
              if (ligne.type_element !== "audience" && ligne.type_element !== "rendez_vous") return [];
              if (ligne.origine_calcul !== null) return [];
              return [{ id: ligne.id, debutMinute, dureeMinute: DUREE_AFFICHEE_MINUTES }];
            }),
          );
          const placeDe = (id: string) => places.find((place) => place.id === id);
          const invitationsDuJourAffichees = invitationsDuJour(elementsInvit, jour);
          return (
            <section key={jour} className="mb-3" data-testid="agenda-jour" data-jour={jour}>
              <h2 className="text-[length:var(--font-size-dense)] font-extrabold">{formatDateLongue(jour)}</h2>
              {duJour.length === 0 && invitationsDuJourAffichees.length === 0 ? (
                <p className="text-graphite">{fr("Rien ce jour-là.")}</p>
              ) : null}
              {invitationsDuJourAffichees.length > 0 ? (
                <ul data-testid="agenda-invitations">
                  {invitationsDuJourAffichees.map((element) => {
                    const presentation = presenterInvitationAgenda(element);
                    return (
                      <li
                        key={element.id}
                        className="mb-1"
                        data-testid="agenda-invitation"
                        data-invitation-id={element.id}
                        data-uid={element.uid}
                        data-effet={element.effet}
                        data-reponse={element.reponse}
                        data-jour={element.jour}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span
                            className={element.annulee ? "text-graphite line-through" : undefined}
                            data-testid="agenda-invitation-titre"
                          >
                            {fr(presentation.libelle)}
                          </span>
                          {presentation.heure !== "" ? (
                            <span data-testid="agenda-invitation-heure">{presentation.heure}</span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--font-size-meta)] text-graphite">
                          {presentation.etat !== null ? (
                            <span data-testid="agenda-invitation-etat">{fr(presentation.etat)}</span>
                          ) : null}
                          {presentation.reponse !== null ? (
                            <span data-testid="agenda-invitation-reponse">{fr(presentation.reponse)}</span>
                          ) : null}
                          {presentation.fuseau !== null ? (
                            <span data-testid="agenda-invitation-fuseau">{fr(presentation.fuseau)}</span>
                          ) : null}
                          {presentation.organisateur !== "" ? (
                            <span data-testid="agenda-invitation-organisateur">{fr(presentation.organisateur)}</span>
                          ) : null}
                          {presentation.avertissement !== null ? (
                            <span data-testid="agenda-invitation-avertissement">{fr(presentation.avertissement)}</span>
                          ) : null}
                          {element.messageId !== null && onOuvrirMail !== undefined ? (
                            <button
                              type="button"
                              className="font-bold text-encre underline underline-offset-[3px]"
                              data-testid="agenda-invitation-ouvrir"
                              onClick={() => {
                                if (element.messageId !== null) onOuvrirMail(element.messageId);
                              }}
                            >
                              {fr("Ouvrir le mail")}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <div data-testid="agenda-sans-heure" className="mb-2">
                <p className="text-graphite">{fr("Sans heure")}</p>
                <ul className="flex flex-col gap-1">
                  {duJour
                    .filter(
                      (ligne) =>
                        ligne.type_element === "tache" ||
                        ligne.origine_calcul !== null ||
                        minutes(ligne) === null,
                    )
                    .map((ligne) => {
                      const attendue = echeanceAttendue(ligne);
                      return (
                        <li key={ligne.id}>
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => {
                              setSelection(ligne.id);
                            }}
                          >
                            {fr(ligne.titre)}
                          </button>
                          {ligne.origine_calcul ? (
                            <button
                              type="button"
                              className="ml-2 font-bold text-encre"
                              data-testid="echeance-voir-calcul"
                              aria-expanded={calculOuvert === ligne.id}
                              onClick={() => {
                                setCalculOuvert((actuel) => (actuel === ligne.id ? null : ligne.id));
                              }}
                            >
                              {fr("Voir le calcul")}
                            </button>
                          ) : null}
                          {calculOuvert === ligne.id && ligne.origine_calcul ? (
                            <p data-testid="echeance-calcul">
                              {fr(
                                `Point de départ ${ligne.origine_calcul}, délai ${String(ligne.jours_calcul ?? 0)} jours. Échéance ${attendue ? formatDateCourte(attendue) : ""}.`,
                              )}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                </ul>
              </div>
              <div
                className="relative"
                data-testid="agenda-grille"
                style={{ height: (GRILLE_FIN - GRILLE_DEBUT) * HAUTEUR_HEURE }}
              >
                {Array.from({ length: GRILLE_FIN - GRILLE_DEBUT + 1 }, (_, index) => GRILLE_DEBUT + index).map(
                  (heureGrille) => (
                    <span
                      key={heureGrille}
                      className="absolute left-0 text-[length:var(--font-size-dense)] text-graphite"
                      style={{ top: (heureGrille - GRILLE_DEBUT) * HAUTEUR_HEURE }}
                    >
                      {fr(`${String(heureGrille)} h`)}
                    </span>
                  ),
                )}
                {duJour
                  .filter(
                    (ligne) =>
                      (ligne.type_element === "audience" || ligne.type_element === "rendez_vous") &&
                      ligne.origine_calcul === null &&
                      minutes(ligne) !== null,
                  )
                  .map((ligne) => {
                    const debut = minutes(ligne);
                    const place = placeDe(ligne.id);
                    if (debut === null || !place) return null;
                    const pos = positionGrille(debut, DUREE_AFFICHEE_MINUTES);
                    if (!pos) return null;
                    const quand = composantesAffichees(ligne.debut);
                    const heure =
                      quand !== null && quand.heure !== null && quand.minute !== null
                        ? formatHeureMur(quand.heure, quand.minute)
                        : "";
                    return (
                      <button
                        key={ligne.id}
                        type="button"
                        className="absolute overflow-hidden rounded-[var(--radius-control)] border border-filet bg-page px-1 text-left"
                        style={{
                          top: pos.top,
                          height: pos.hauteur,
                          left: `calc(3rem + ${String((place.colonne * 100) / place.colonnes)}%)`,
                          width: `calc(${String(100 / place.colonnes)}% - 3rem)`,
                        }}
                        data-colonne={place.colonne}
                        data-colonnes={place.colonnes}
                        data-selected={selection === ligne.id ? "true" : "false"}
                        onClick={() => {
                          setSelection(ligne.id);
                        }}
                      >
                        <span>{fr(ligne.titre)}</span>
                        {heure !== "" ? <span data-testid="agenda-element-heure">{heure}</span> : null}
                      </button>
                    );
                  })}
              </div>
            </section>
          );
        })}
      </div>
      <aside className="mt-4 rounded-[var(--radius-control)] border border-filet p-3" data-testid="agenda-apercu">
        {choisi ? (
          <>
            <h2 className="font-extrabold">{fr(choisi.titre)}</h2>
            <p className="text-graphite">
              {fr(LIBELLES_TYPE[choisi.type_element] ?? choisi.type_element)}
              {choisi.origine_calcul ? fr(", calculé") : ""}
            </p>
          </>
        ) : (
          <p className="text-graphite">{fr("Aucun élément sélectionné.")}</p>
        )}
      </aside>
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
