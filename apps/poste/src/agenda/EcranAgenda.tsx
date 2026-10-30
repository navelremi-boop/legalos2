import { useEffect, useMemo, useState } from "react";
import { Annonce } from "@/coque/Annonce";
import type { CSSProperties, SubmitEvent } from "react";
import {
  ecrireElementAgenda,
  modifierElementAgenda,
  recalculerEcheance,
  retirerEcheance,
  type TypeAgenda,
} from "@/agenda/ecrireAgenda";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { PanneauLateral } from "@/coque/PanneauLateral";
import { ChoixDossier } from "@/dossiers/ChoixDossier";
import { lireDossiersChoix } from "@/dossiers/lireDossiersChoix";
import type { DossierChoix } from "@/dossiers/rechercheDossier";
import { lireInvitations } from "@/agenda/donneesInvitations";
import { composantesAffichees } from "@/agenda/fuseauParis";
import {
  elementsInvitations,
  invitationsDuJour,
  presenterInvitationAgenda,
  type ElementInvitation,
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
  sousTitrePeriode,
  type CategorieAgenda,
} from "@/agenda/dispositionAgenda";
import {
  decalerJour,
  debutMois,
  grilleMois,
  INITIALES_JOURS,
  jourCivil,
  joursSemaineAffiches,
  libelleMois,
  semaineDe,
} from "@/agenda/navigationAgenda";
import { FormulaireDelai } from "@/delais/FormulaireDelai";
import { calculerDelaiComplet } from "@/delais/moteur";
import { isChemiseId } from "@/lib/chemise";
import { formatDateCourte, formatDateLongue, formatHeureMur } from "@/lib/format";
import { fr } from "@/lib/fr";
import { libelleReferenceDossier } from "@/lib/referenceDossier";
import type { InvitationLocale } from "@/messagerie/typesMails";
import { getPowerSyncDatabase } from "@/sync/database";

type Ligne = {
  id: string;
  dossier_id: string;
  type_element: string;
  titre: string;
  debut: string;
  rappel_le: string | null;
  /** Galerie seulement : le nom n'est pas une colonne de l'élément. */
  dossier_nom?: string | null;
  dossier_reference?: string | null;
  dossier_chemise?: string | null;
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

function libelleRappel(rappel: string | null): string | null {
  if (!rappel || rappel.trim() === "") return null;
  const mur = composantesAffichees(rappel);
  if (!mur) return rappel.trim();
  const heure = mur.heure !== null && mur.minute !== null ? ` ${formatHeureMur(mur.heure, mur.minute)}` : "";
  return `${formatDateLongue(mur.jour)}${heure}`;
}

function libelleQuand(debut: string): string {
  const mur = composantesAffichees(debut);
  if (!mur) return "";
  const heure = mur.heure !== null && mur.minute !== null ? ` ${formatHeureMur(mur.heure, mur.minute)}` : "";
  return `${formatDateLongue(mur.jour)}${heure}`;
}

/** Heure courante sur la colonne du jour, remise à jour chaque minute. */
function TraitMaintenant() {
  const [minutes, setMinutes] = useState(() => {
    const maintenant = new Date();
    return maintenant.getHours() * 60 + maintenant.getMinutes();
  });
  useEffect(() => {
    const minuterie = window.setInterval(() => {
      const maintenant = new Date();
      setMinutes(maintenant.getHours() * 60 + maintenant.getMinutes());
    }, 60_000);
    return () => {
      window.clearInterval(minuterie);
    };
  }, []);
  const position = positionGrille(minutes, 0);
  if (!position) return null;
  return <span className="agenda-maintenant" style={{ top: position.top }} aria-hidden="true" />;
}

function BlocInvitation({
  element,
  style,
  onOuvrirMail,
}: {
  element: ElementInvitation;
  style?: CSSProperties;
  onOuvrirMail?: (messageId: string) => void;
}) {
  const presentation = presenterInvitationAgenda(element);
  return (
    <div
      className={
        style
          ? "agenda-bloc agenda-bloc--invitation absolute"
          : "agenda-sans-heure__element"
      }
      style={style}
      title={fr(
        [presentation.libelle, presentation.heure, presentation.etat, presentation.reponse, presentation.organisateur]
          .filter((morceau) => morceau !== null && morceau !== "")
          .join(", "),
      )}
      data-testid="agenda-invitation"
      data-invitation-id={element.id}
      data-uid={element.uid}
      data-effet={element.effet}
      data-reponse={element.reponse}
      data-jour={element.jour}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`truncate ${element.annulee ? "text-graphite line-through" : ""}`}
          data-testid="agenda-invitation-titre"
        >
          {fr(presentation.libelle)}
        </span>
        {presentation.heure !== "" ? (
          <span data-testid="agenda-invitation-heure">{presentation.heure}</span>
        ) : null}
      </div>
      <div className="agenda-bloc__detail">
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
            className="lien-action text-[length:var(--font-size-meta)]"
            data-testid="agenda-invitation-ouvrir"
            onClick={() => {
              if (element.messageId !== null) onOuvrirMail(element.messageId);
            }}
          >
            {fr("Ouvrir le mail")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

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
  onSaisirTemps?: () => void;
  /** Ouvre l'écran Mails sur le message dont l'en-tête Message-ID est donné (lien « Ouvrir le mail » d'une invitation). */
  onOuvrirMail?: (messageId: string) => void;
  onOuvrirDossier?: (id: string, nom: string, chemise: string, reference?: string | null) => void;
  /** Galerie : pas de PowerSync. */
  lignesFixes?: Ligne[];
  invitationsFixes?: InvitationLocale[];
};

export function EcranAgenda({
  onSaisirTemps,
  onOuvrirMail,
  onOuvrirDossier,
  lignesFixes,
  invitationsFixes,
}: EcranAgendaProps) {
  const [lignesSync, setLignesSync] = useState<Ligne[]>([]);
  const [dossiersConnus, setDossiersConnus] = useState<
    Map<string, { nom: string; reference: string | null; chemise: string | null }>
  >(() => new Map());
  const lignes = lignesFixes ?? lignesSync;
  const [invitationsSync, setInvitationsSync] = useState<InvitationLocale[]>([]);
  const invitations = invitationsFixes ?? invitationsSync;
  const elementsInvit = useMemo(() => elementsInvitations(invitations), [invitations]);
  /** Jour de repère de la vue ; `null` : aujourd'hui, qui suit l'horloge. */
  const [ancre, setAncre] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [edition, setEdition] = useState("");
  const [conflit, setConflit] = useState("");
  const [creation, setCreation] = useState(false);
  const [calcul, setCalcul] = useState(false);
  const [dossierCreation, setDossierCreation] = useState("");
  const [dossiersChoix, setDossiersChoix] = useState<DossierChoix[]>([]);
  useEffect(() => {
    if (!creation) return;
    let stop = false;
    void lireDossiersChoix()
      .then((lignes) => {
        if (!stop) setDossiersChoix(lignes);
      })
      .catch(() => {
        if (!stop) setDossiersChoix([]);
      });
    return () => {
      stop = true;
    };
  }, [creation]);
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

  const dossiersGalerie = useMemo(() => {
    const cartes = new Map<string, { nom: string; reference: string | null; chemise: string | null }>();
    for (const ligne of lignesFixes ?? []) {
      if (!ligne.dossier_nom) continue;
      cartes.set(ligne.dossier_id, {
        nom: ligne.dossier_nom,
        reference: ligne.dossier_reference ?? null,
        chemise: ligne.dossier_chemise ?? null,
      });
    }
    return cartes;
  }, [lignesFixes]);
  const dossiersAffiches = lignesFixes ? dossiersGalerie : dossiersConnus;

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
          const connus = await database.getAll<{ id: string; nom: string; reference: string | null; chemise: string | null }>(
            "SELECT id, nom, reference, chemise FROM dossiers",
          );
          if (arrete()) return;
          setDossiersConnus(
            new Map(connus.map((dossier) => [dossier.id, { nom: dossier.nom, reference: dossier.reference, chemise: dossier.chemise }])),
          );
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
      setDossierCreation("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Enregistrement impossible."));
    }
  }

  async function modifier(event: SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await modifierElementAgenda({
        id,
        titre: champ(form, "titre"),
        debut: champ(form, "debut"),
        rappelLe: champ(form, "rappel_le"),
      });
      setEdition("");
      setMessage(fr("Élément modifié."));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Modification impossible."));
    }
  }

  const jourRepere = ancre ?? jourCivil(new Date());
  const joursOccupes = new Set<string>();
  for (const ligne of lignes) {
    const jour = composantesAffichees(ligne.debut)?.jour;
    if (jour) joursOccupes.add(jour);
  }
  const joursBarre =
    vue === "jour" ? [jourRepere] : joursSemaineAffiches(semaineDe(jourRepere), joursOccupes);
  const debutBarre = joursBarre[0] ?? jourRepere;
  const finBarre = joursBarre[joursBarre.length - 1] ?? jourRepere;
  const titreBarre =
    vue === "jour" || debutBarre === finBarre
      ? `${formatDateLongue(debutBarre)} ${debutBarre.slice(0, 4)}`
      : `${formatDateLongue(debutBarre)} au ${formatDateLongue(finBarre)} ${finBarre.slice(0, 4)}`;
  const mois = moisAffiche ?? debutMois(jourRepere);
  const casesMois = grilleMois(mois);
  const lignesVisibles = lignes.filter((ligne) => filtres[categorieAgenda(ligne.type_element, ligne.origine_calcul)]);
  const comptesPeriode = { audience: 0, rendez_vous: 0, echeance: 0 };
  const comptesFiltres: Record<CategorieAgenda, number> = {
    audience: 0,
    rendez_vous: 0,
    tache: 0,
    echeance: 0,
  };
  for (const ligne of lignes) {
    const jour = composantesAffichees(ligne.debut)?.jour;
    if (!jour || !joursBarre.includes(jour)) continue;
    const categorie = categorieAgenda(ligne.type_element, ligne.origine_calcul);
    comptesFiltres[categorie] += 1;
    if (categorie === "tache") continue;
    comptesPeriode[categorie] += 1;
  }
  const aujourdhui = jourCivil(new Date());
  const quandPeriode =
    vue === "jour"
      ? jourRepere === aujourdhui
        ? "aujourd'hui"
        : `le ${formatDateLongue(jourRepere)}`
      : joursBarre.includes(aujourdhui)
        ? "cette semaine"
        : `la semaine du ${formatDateCourte(debutBarre)}`;
  const sousTitre = sousTitrePeriode(comptesPeriode, quandPeriode);
  const choisi =
    lignesVisibles.find((ligne) => {
      if (ligne.id !== selection) return false;
      const jour = composantesAffichees(ligne.debut)?.jour;
      return jour !== undefined && joursBarre.includes(jour);
    }) ?? null;
  const ficheDossier = choisi ? dossiersAffiches.get(choisi.dossier_id) : undefined;
  const rappelAffiche = choisi ? libelleRappel(choisi.rappel_le) : null;
  const prochaines = prochainesEcheances(
    lignesVisibles.flatMap((ligne) => {
      if (!ligne.origine_calcul) return [];
      const quand = composantesAffichees(ligne.debut);
      if (!quand) return [];
      return [
        {
          id: ligne.id,
          jour: quand.jour,
          debutMinute: (quand.heure ?? 0) * 60 + (quand.minute ?? 0),
          titre: ligne.titre,
          origine: ligne.origine_calcul,
          echeance: true as const,
        },
      ];
    }),
    jourCivil(new Date()),
  );

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col ecran ecran--large"
      data-testid="ecran-agenda"
      data-fond="neutre"
    >
      <header className="ecran-tete">
        <div>
          <h1 className="ecran-tete__titre">{fr("Agenda")}</h1>
          <p className="ecran-tete__sous-titre" data-testid="agenda-sous-titre">
            {fr(sousTitre)}
          </p>
        </div>
      </header>
      <Feuille uneColonne className="min-h-[360px]">
      <div className="grid h-full min-h-0 grid-cols-[17.5rem_minmax(0,1fr)_17rem]">
      <aside className="agenda-volet min-h-0 overflow-y-auto border-r border-filet">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="agenda-mois">{fr(libelleMois(mois))}</p>
          <span className="flex gap-1">
            <button
              type="button"
              className="bouton bouton--discret bouton--petit"
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
              className="bouton bouton--discret bouton--petit"
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
        <div className="agenda-mini__initiales" data-testid="agenda-mini-initiales" aria-hidden="true">
          {INITIALES_JOURS.map((initiale, index) => (
            <span key={`${initiale}-${String(index)}`}>{fr(initiale)}</span>
          ))}
        </div>
        <div className="agenda-mini" data-testid="agenda-mini">
          {casesMois.map((cellule) => (
            <button
              key={cellule.jour}
              type="button"
              className="agenda-mini__jour"
              data-testid="agenda-mini-jour"
              data-jour={cellule.jour}
              data-dans-mois={cellule.dansMois ? "true" : "false"}
              data-aujourdhui={cellule.jour === aujourdhui ? "true" : "false"}
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
        <div className="filtres mt-5" role="group" aria-label={fr("Types d'éléments")}>
          {CATEGORIES_AGENDA.map((categorie) => {
            const compte = comptesFiltres[categorie];
            return (
              <button
                key={categorie}
                type="button"
                className="filtre"
                aria-pressed={filtres[categorie]}
                data-testid={`agenda-filtre-${categorie}`}
                onClick={() => {
                  setFiltres((actuel) => ({ ...actuel, [categorie]: !actuel[categorie] }));
                }}
              >
                {fr(LIBELLES_TYPE[categorie] ?? categorie)} <b className="filtre__compte">{compte}</b>
              </button>
            );
          })}
        </div>
        <h2 className="feuille-sous-titre mt-6 mb-2">{fr("Prochaines échéances")}</h2>
        <ul className="agenda-prochaines" data-testid="agenda-prochaines">
          {prochaines.length === 0 ? (
            <li className="text-[length:var(--font-size-dense)] text-graphite">{fr("Aucune échéance à venir.")}</li>
          ) : (
            prochaines.map((ligne) => (
              <li key={ligne.id}>
                <button
                  type="button"
                  className="agenda-prochaines__ligne"
                  onClick={() => {
                    setAncre(ligne.jour);
                  }}
                >
                  <span className="agenda-prochaines__date">{fr(formatDateCourte(ligne.jour))}</span>
                  <span className="min-w-0">{fr(ligne.titre)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
      <div className="min-h-0 min-w-0 overflow-y-auto p-[22px] pb-24">
      <div className="agenda-nav">
      <div className="flex flex-nowrap items-center gap-1">
        <button
          type="button"
          className="bouton bouton--discret bouton--petit"
          data-testid="agenda-precedent"
          onClick={() => {
            setAncre(decalerJour(ancre ?? jourCivil(new Date()), vue === "jour" ? -1 : -7));
          }}
        >
          {fr(vue === "jour" ? "Jour précédent" : "Semaine précédente")}
        </button>
        <button
          type="button"
          className="bouton bouton--discret bouton--petit"
          data-testid="agenda-suivant"
          onClick={() => {
            setAncre(decalerJour(ancre ?? jourCivil(new Date()), vue === "jour" ? 1 : 7));
          }}
        >
          {fr(vue === "jour" ? "Jour suivant" : "Semaine suivante")}
        </button>
        <button
          type="button"
          className="bouton bouton--petit"
          data-testid="agenda-aujourdhui"
          onClick={() => {
            setAncre(null);
          }}
        >
          {fr("Aujourd'hui")}
        </button>
      </div>
      <h2 className="agenda-nav__titre">{fr(titreBarre)}</h2>
      <div className="segment" role="group" aria-label={fr("Affichage")}>
        <button
          type="button"
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
          data-testid="agenda-vue-semaine"
          aria-pressed={vue === "semaine"}
          onClick={() => {
            setVue("semaine");
          }}
        >
          {fr("Semaine")}
        </button>
      </div>
      </div>
      <PanneauLateral
        ouvert={creation}
        titre="Nouvel élément d'agenda"
        sousTitre="Audience, rendez-vous ou tâche, rattaché à un dossier."
        onFermer={() => {
          setCreation(false);
        }}
      >
      <form
        data-testid="agenda-panneau-creation"
        onSubmit={(event) => void ajouter(event)}
      >
        <label className="etiquette-champ" htmlFor="agenda-type">
          {fr("Type")}
        </label>
        <select
          id="agenda-type"
          name="type_element"
          data-testid="agenda-type"
          className="champ mb-4"
          defaultValue="audience"
        >
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {fr(type === "rendez_vous" ? "Rendez-vous" : type === "tache" ? "Tâche" : "Audience")}
            </option>
          ))}
        </select>
        <label className="etiquette-champ" htmlFor="agenda-dossier-recherche">
          {fr("Dossier")}
        </label>
        <div className="mb-4">
          <ChoixDossier
            id="agenda-dossier"
            name="dossier_id"
            testId="agenda-dossier"
            support="champ"
            dossiers={dossiersChoix}
            valeur={dossierCreation}
            onChange={setDossierCreation}
            required
          />
        </div>
        <label className="etiquette-champ" htmlFor="agenda-titre">
          {fr("Titre")}
        </label>
        <input
          id="agenda-titre"
          name="titre"
          required
          data-testid="agenda-titre"
          placeholder={fr("Audience de mise en état, rendez-vous client…")}
          className="champ mb-4"
        />
        <p className="etiquette-champ">{fr("Date et heure")}</p>
        <div className="mb-4 flex gap-2">
          <input
            type="date"
            data-testid="agenda-date"
            aria-label={fr("Date")}
            className="champ"
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
            className="champ"
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
        <label className="etiquette-champ" htmlFor="agenda-rappel-liste">
          {fr("Rappel")}
        </label>
        <select
          id="agenda-rappel-liste"
          data-testid="agenda-rappel-liste"
          className="champ mb-4"
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
        <div className="formulaire-actions">
          <button
            type="submit"
            data-testid="agenda-ajouter"
            className="bouton bouton--prim"
          >
            {fr("Ajouter à l'agenda")}
          </button>
        </div>
        <Annonce texte={message} succes={message === fr("Élément inscrit à l'agenda.")} testId="agenda-message" />
      </form>
      </PanneauLateral>
      <PanneauLateral
        ouvert={calcul}
        titre="Calculer un délai"
        sousTitre="Point de départ, durée et report au premier jour ouvrable."
        onFermer={() => {
          setCalcul(false);
        }}
      >
        {calcul ? (
          <div data-testid="agenda-calcul-delai">
            <FormulaireDelai dossierId={choisi?.dossier_id} />
          </div>
        ) : null}
      </PanneauLateral>
      {conflit !== "" ? (
        <p
          className="message-attention mb-4"
          data-testid="agenda-conflit"
          role="status"
        >
          {fr(`Conflit d'agenda : « ${conflit} ».`)}
        </p>
      ) : null}
      <div
        className="grid min-w-0"
        style={{
          gridTemplateColumns: `6.5rem repeat(${String(
            (vue === "jour"
              ? [jourRepere]
              : joursSemaineAffiches(
                  semaineDe(jourRepere),
                  new Set(
                    lignesVisibles.flatMap((ligne) => {
                      const jour = composantesAffichees(ligne.debut)?.jour;
                      return jour ? [jour] : [];
                    }),
                  ),
                )
            ).length,
          )}, minmax(0, 1fr))`,
          gridTemplateRows: "auto auto auto",
        }}
        data-testid={vue === "jour" ? "agenda-vue-jour-contenu" : "agenda-vue-semaine-contenu"}
      >
        <p
          className="agenda-sans-heure-titre whitespace-nowrap"
          style={{ gridColumn: 1, gridRow: 2 }}
          data-testid="agenda-sans-heure-titre"
        >
          {fr("Sans heure")}
        </p>
        <div
          className="relative"
          style={{ gridColumn: 1, gridRow: 3, height: (GRILLE_FIN - GRILLE_DEBUT) * HAUTEUR_HEURE }}
        >
          {Array.from({ length: GRILLE_FIN - GRILLE_DEBUT + 1 }, (_, index) => GRILLE_DEBUT + index).map(
            (heureGrille) => (
              <span
                key={heureGrille}
                className="agenda-heure"
                style={{ top: (heureGrille - GRILLE_DEBUT) * HAUTEUR_HEURE }}
              >
                {fr(`${String(heureGrille)} h`)}
              </span>
            ),
          )}
        </div>
        {(vue === "jour"
          ? [jourRepere]
          : joursSemaineAffiches(
              semaineDe(jourRepere),
              new Set(
                lignesVisibles.flatMap((ligne) => {
                  const jour = composantesAffichees(ligne.debut)?.jour;
                  return jour ? [jour] : [];
                }),
              ),
            )
        ).map((jour, indexJour) => {
          const colonne = indexJour + 2;
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
            <section key={jour} className="contents" style={{ display: "contents" }} data-testid="agenda-jour" data-jour={jour}>
              <h2
                className="agenda-jour__titre"
                style={{ gridColumn: colonne, gridRow: 1 }}
                data-aujourdhui={jour === aujourdhui ? "true" : "false"}
              >
                {fr(formatDateLongue(jour))}
              </h2>
              <div className="agenda-sans-heure" data-testid="agenda-sans-heure" style={{ gridColumn: colonne, gridRow: 2 }}>
                {vue === "jour" && duJour.length === 0 && invitationsDuJourAffichees.length === 0 ? (
                  <p className="text-[length:var(--font-size-dense)] text-graphite">{fr("Rien ce jour-là.")}</p>
                ) : null}
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
                        <li key={ligne.id} className="agenda-sans-heure__element">
                          <button
                            type="button"
                            className="block w-full truncate text-left font-bold"
                            onClick={() => {
                              setSelection(ligne.id);
                            }}
                          >
                            {fr(ligne.titre)}
                          </button>
                          {ligne.origine_calcul ? (
                            <button
                              type="button"
                              className="lien-action text-[length:var(--font-size-meta)]"
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
                            <p className="mt-1 text-[length:var(--font-size-meta)] text-graphite" data-testid="echeance-calcul">
                              {fr(
                                `Point de départ ${ligne.origine_calcul}, délai ${String(ligne.jours_calcul ?? 0)} jours. Échéance ${attendue ? formatDateCourte(attendue) : ""}.`,
                              )}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  {invitationsDuJourAffichees
                    .filter((element) => element.minutes === null)
                    .map((element) => (
                      <BlocInvitation key={element.id} element={element} onOuvrirMail={onOuvrirMail} />
                    ))}
                </ul>
              </div>
              <div
                className="agenda-grille relative"
                data-aujourdhui={jour === aujourdhui ? "true" : "false"}
                data-testid="agenda-grille"
                style={{
                  gridColumn: colonne,
                  gridRow: 3,
                  height: (GRILLE_FIN - GRILLE_DEBUT) * HAUTEUR_HEURE,
                }}
              >
                {Array.from({ length: GRILLE_FIN - GRILLE_DEBUT }, (_, index) => (
                  <span
                    key={index}
                    data-testid="agenda-ligne-heure"
                    className="agenda-ligne-heure"
                    style={{ top: (index + 1) * HAUTEUR_HEURE }}
                  />
                ))}
                {jour === aujourdhui ? <TraitMaintenant /> : null}
                {invitationsDuJourAffichees
                  .filter((element) => element.minutes !== null)
                  .map((element) => {
                    const debut = element.minutes;
                    if (debut === null) return null;
                    const pos = positionGrille(debut, DUREE_AFFICHEE_MINUTES);
                    if (!pos) return null;
                    return (
                      <BlocInvitation
                        key={element.id}
                        element={element}
                        onOuvrirMail={onOuvrirMail}
                        style={{ top: pos.top, height: pos.hauteur, left: 0, right: 0 }}
                      />
                    );
                  })}
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
                        className="agenda-bloc absolute text-left"
                        data-chemise={ligne.dossier_chemise ?? undefined}
                        style={{
                          top: pos.top,
                          height: pos.hauteur,
                          left: `${String((place.colonne * 100) / place.colonnes)}%`,
                          width: `${String(100 / place.colonnes)}%`,
                        }}
                        data-colonne={place.colonne}
                        data-colonnes={place.colonnes}
                        data-selected={selection === ligne.id ? "true" : "false"}
                        onClick={() => {
                          setSelection(ligne.id);
                        }}
                      >
                        <span className="block truncate font-bold">{fr(ligne.titre)}</span>
                        {heure !== "" ? (
                          <span className="block truncate text-graphite" data-testid="agenda-element-heure">
                            {heure}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            </section>
          );
        })}
      </div>
      </div>
      <aside className="agenda-volet min-h-0 overflow-y-auto border-l border-filet" data-testid="agenda-apercu">
        {choisi && edition === choisi.id ? (
          <form
            data-testid="agenda-modifier-form"
            onSubmit={(event) => void modifier(event, choisi.id)}
          >
            <h2 className="feuille-titre mb-3">{fr("Modifier")}</h2>
            <label className="etiquette-champ" htmlFor="agenda-mod-titre">
              {fr("Titre")}
            </label>
            <input
              id="agenda-mod-titre"
              name="titre"
              required
              defaultValue={choisi.titre}
              className="champ mb-3"
            />
            <label className="etiquette-champ" htmlFor="agenda-mod-debut">
              {fr("Début")}
            </label>
            <input
              id="agenda-mod-debut"
              name="debut"
              required
              defaultValue={choisi.debut}
              className="champ mb-3"
            />
            <label className="etiquette-champ" htmlFor="agenda-mod-rappel">
              {fr("Rappel")}
            </label>
            <input
              id="agenda-mod-rappel"
              name="rappel_le"
              defaultValue={choisi.rappel_le ?? ""}
              className="champ mb-3"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="bouton"
              >
                {fr("Enregistrer")}
              </button>
              <button
                type="button"
                className="bouton"
                onClick={() => {
                  setEdition("");
                }}
              >
                {fr("Annuler")}
              </button>
            </div>
          </form>
        ) : choisi ? (
          <>
            <h2 className="feuille-titre">{fr(choisi.titre)}</h2>
            <p className="mb-3 text-[length:var(--font-size-dense)] text-graphite">
              {fr(LIBELLES_TYPE[choisi.type_element] ?? choisi.type_element)}
              {choisi.origine_calcul ? fr(", calculé") : ""}
            </p>
            <p>{fr(libelleQuand(choisi.debut))}</p>
            {ficheDossier ? (
              <p className="flex flex-wrap items-baseline gap-x-1">
                <span className="text-graphite">{fr("Dossier")}</span>
                <span>{fr(ficheDossier.nom)}</span>
                {ficheDossier.reference ? (
                  <span className="chiffres-reference whitespace-nowrap">
                    {fr(libelleReferenceDossier(ficheDossier.reference))}
                  </span>
                ) : null}
              </p>
            ) : null}
            {rappelAffiche ? <p data-testid="agenda-rappel-affiche">{fr(`Rappel, ${rappelAffiche}`)}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {onOuvrirDossier && ficheDossier?.chemise && isChemiseId(ficheDossier.chemise) ? (
                <button
                  type="button"
                  className="bouton"
                  onClick={() => {
                    if (!ficheDossier.chemise) return;
                    onOuvrirDossier(choisi.dossier_id, ficheDossier.nom, ficheDossier.chemise, ficheDossier.reference);
                  }}
                >
                  {fr("Ouvrir le dossier")}
                </button>
              ) : null}
              <button
                type="button"
                className="bouton"
                data-testid="agenda-modifier"
                onClick={() => {
                  setEdition(choisi.id);
                }}
              >
                {fr("Modifier")}
              </button>
              {confirmation === choisi.id ? (
                <>
                  <button
                    type="button"
                    className="bouton"
                    onClick={() => {
                      void retirerEcheance(choisi.id).then(() => {
                        setConfirmation("");
                        setSelection(null);
                      });
                    }}
                  >
                    {fr("Confirmer la suppression")}
                  </button>
                  <button
                    type="button"
                    className="bouton"
                    onClick={() => {
                      setConfirmation("");
                    }}
                  >
                    {fr("Garder")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="bouton"
                  data-testid="agenda-fiche-supprimer"
                  onClick={() => {
                    setConfirmation(choisi.id);
                  }}
                >
                  {fr("Supprimer")}
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="etat-vide">{fr("Choisissez un élément de l'agenda pour en voir le détail.")}</p>
        )}
      </aside>
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
      </Feuille>
      <BarreActions
        actions={[
          {
            id: "nouvel-element",
            label: "Nouvel élément",
            primaire: true,
            testId: "agenda-creer",
            onClick: () => {
              setCalcul(false);
              setCreation(true);
            },
          },
          {
            id: "calculer-delai",
            label: "Calculer un délai",
            testId: "agenda-calculer-delai",
            onClick: () => {
              setCreation(false);
              setCalcul(true);
            },
          },
          {
            id: "saisir-temps",
            label: "Saisir du temps",
            raccourci: "T",
            onClick: () => {
              onSaisirTemps?.();
            },
          },
        ]}
      />
    </div>
  );
}
