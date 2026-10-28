import { useEffect, useState, type ReactNode } from "react";
import { Feuille } from "@/coque/Feuille";
import { BarreActions } from "@/coque/BarreActions";
import { composantesAffichees } from "@/agenda/fuseauParis";
import { jourCivil } from "@/agenda/navigationAgenda";
import { classerMessage } from "@/messagerie/apiMessagerie";
import { CONDITION_SQL_A_CLASSER } from "@/messagerie/classement";
import { propositionTemps } from "@/messagerie/tempsMail";
import { isChemiseId, type ChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";
import { JOURNEE_DEMO, type DonneesJournee, type LigneJournee } from "@/screens/journeeDemo";
import { formatDateLongue, formatDuree, formatMontant } from "@/lib/format";
import { getPowerSyncDatabase } from "@/sync/database";
import {
  delaiAffiche,
  libelleEcart,
  libelleHeure,
  libelleProchainRendezVous,
  ligneDelai,
  ligneMail,
  ligneTemps,
  minutesDepuisLibelle,
  partAnneau,
} from "@/screens/assemblerJournee";
type JourneeProps = {
  onNouveauDossier: () => void;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
  onOuvrirFacturation?: () => void;
  onOuvrirAgenda?: () => void;
  /** Affiche le jeu fictif (galerie). Sans cela, les quatre sections viennent de la base locale. */
  donneesDemo?: boolean;
  donnees?: DonneesJournee;
  instanceUrl?: string;
};

function AnneauJours({ jours }: { jours: number }) {
  const rayon = 14;
  const tour = 2 * Math.PI * rayon;
  const part = partAnneau(jours);
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 38 38"
      aria-hidden
      data-testid="journee-anneau"
      data-jours={jours}
    >
      <circle cx="19" cy="19" r={rayon} fill="none" stroke="var(--arc-piste)" strokeWidth="4.2" />
      <circle
        cx="19"
        cy="19"
        r={rayon}
        fill="none"
        stroke="var(--encre)"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeDasharray={`${String(tour * part)} ${String(tour)}`}
        transform="rotate(-90 19 19)"
      />
      <text x="19" y="23" textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--encre)">
        {String(jours)}
      </text>
    </svg>
  );
}

function Pastille({ chemise, reference }: { chemise: ChemiseId; reference?: string | null }) {
  if (reference) {
    return (
      <span className="mails-dos" data-testid="pastille-dossier" data-chemise={chemise}>
        <i aria-hidden />
        {fr(reference)}
      </span>
    );
  }
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
  lien,
  onLien,
  onClasser,
  onSaisir,
  dossiersChoix,
  choixOuvert,
  onAutre,
  onAnnulerChoix,
  faites,
  onBasculerTache,
  annonce,
}: {
  id: string;
  titre: string;
  lignes: LigneJournee[];
  vide: string;
  lien?: string;
  onLien?: () => void;
  onClasser?: (messageId: string, dossierId: string) => void;
  onSaisir?: () => void;
  dossiersChoix?: readonly { id: string; nom: string }[];
  choixOuvert?: string | null;
  onAutre?: (id: string) => void;
  onAnnulerChoix?: () => void;
  faites?: ReadonlySet<string>;
  onBasculerTache?: (id: string) => void;
  annonce?: ReactNode;
}) {
  const evenements = lignes.filter((ligne) => !ligne.tache);
  const taches = lignes.filter((ligne) => ligne.tache);
  return (
    <section data-testid={`section-${id}`}>
      <h2 className="mb-2 flex items-baseline gap-3 text-[length:var(--font-size-section)] font-extrabold">
        <span>{fr(titre)}</span>
        {lien !== undefined ? (
          <button type="button" className="ml-auto text-[length:var(--font-size-dense)] font-bold text-encre" onClick={onLien}>
            {fr(lien)}
          </button>
        ) : null}
      </h2>
      {annonce}
      {lignes.length === 0 ? (
        <p className="text-graphite">{fr(vide)}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {evenements.map((ligne) => (
            <li
              key={ligne.id}
              className={`ligne-journee${ligne.urgent ? " ligne-journee--urgent" : ""}`}
            >
              {ligne.jours !== undefined ? <AnneauJours jours={ligne.jours} /> : null}
              {ligne.heure ? (
                <span className="shrink-0 whitespace-nowrap font-bold" data-testid="journee-heure">
                  {fr(ligne.heure)}
                </span>
              ) : null}
              {ligne.dossier ? <Pastille chemise={ligne.dossier.chemise} reference={ligne.dossier.reference} /> : null}
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
                {ligne.extrait ? (
                  <p className="truncate text-[length:var(--font-size-dense)] text-graphite" data-testid="journee-extrait">
                    {fr(ligne.extrait)}
                  </p>
                ) : null}
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
              {ligne.classer && choixOuvert === ligne.id ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const choisi = new FormData(event.currentTarget).get("dossier");
                    if (typeof choisi === "string" && choisi !== "") {
                      onClasser?.(ligne.classer?.messageId ?? "", choisi);
                    }
                    onAnnulerChoix?.();
                  }}
                >
                  <select
                    name="dossier"
                    className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                    data-testid="journee-choix-dossier"
                    defaultValue={ligne.classer.dossierId}
                  >
                    {(dossiersChoix ?? []).map((dossier) => (
                      <option key={dossier.id} value={dossier.id}>
                        {fr(dossier.nom)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                  >
                    {fr("Classer")}
                  </button>
                  <button type="button" className="text-graphite" onClick={onAnnulerChoix}>
                    {fr("Annuler")}
                  </button>
                </form>
              ) : null}
              {ligne.classer && choixOuvert !== ligne.id ? (
                <button
                  type="button"
                  className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                  data-testid="journee-autre-dossier"
                  onClick={() => {
                    onAutre?.(ligne.id);
                  }}
                >
                  {fr("Autre dossier")}
                </button>
              ) : null}
              {ligne.jours !== undefined ? (
                <span className="shrink-0 text-right font-bold" data-testid="journee-dans">
                  {fr(libelleEcart(ligne.jours))}
                </span>
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
                  {fr(ligne.saisir.minutes > 0 ? `Saisir ${formatDuree(ligne.saisir.minutes * 60)}` : "Saisir")}
                </button>
              ) : null}
            </li>
          ))}
          {taches.length > 0 ? (
            <li className="mt-3 list-none font-bold">{fr("À faire aujourd'hui")}</li>
          ) : null}
          {taches.map((ligne) => {
            const faite = faites?.has(ligne.id) ?? false;
            return (
              <li key={ligne.id} className="ligne-journee">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={faite}
                  aria-label={fr(`Marquer comme faite : ${ligne.titre}`)}
                  data-testid="journee-tache"
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-[var(--radius-control)] border border-filet ${faite ? "bg-encre" : "bg-page"}`}
                  onClick={() => {
                    onBasculerTache?.(ligne.id);
                  }}
                />
                {ligne.dossier ? <Pastille chemise={ligne.dossier.chemise} reference={ligne.dossier.reference} /> : null}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{fr(ligne.titre)}</div>
                  <div className="truncate text-[length:var(--font-size-dense)] text-graphite">{fr(ligne.meta)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Journee({
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
  onOuvrirFacturation,
  onOuvrirAgenda,
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
  const nonFacture = jeu?.nonFacture ?? { minutes: 0, htCentimes: 0 };
  const [faites, setFaites] = useState<Set<string>>(() => new Set());
  const [choixOuvert, setChoixOuvert] = useState<string | null>(null);
  const [dossiersSync, setDossiersSync] = useState<{ id: string; nom: string }[]>([]);
  const dossiersChoix = fixe
    ? [
        { id: "ferrand", nom: "Ferrand Métal" },
        { id: "lilas", nom: "SCI des Lilas" },
        { id: "martin", nom: "Martin / Assurances Loire" },
      ]
    : dossiersSync;

  function basculerTache(id: string) {
    setFaites((actuel) => {
      const suivant = new Set(actuel);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  useEffect(() => {
    if (fixe) return;
    let stop = false;
    const charger = () => {
      const aujourd = jourCivil(new Date());
      void getPowerSyncDatabase()
        .then(async (database) => {
          const [agendas, dossiers, aClasser, classes, saisies, factures] = await Promise.all([
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
            database.getAll<{ id: string; nom: string; chemise: string; reference: string | null }>(
              "SELECT id, nom, chemise, reference FROM dossiers",
            ),
            database.getAll<{
              id: string;
              objet: string | null;
              expediteur: string | null;
              extrait_texte: string | null;
              suggestion_dossier_id: string | null;
            }>(
              `SELECT id, objet, expediteur, extrait_texte, suggestion_dossier_id FROM messages
               WHERE ${CONDITION_SQL_A_CLASSER} LIMIT 8`,
            ),
            database.getAll<{ id: string; dossier_id: string }>(
              "SELECT id, dossier_id FROM messages WHERE etat_classement = 'classe' AND dossier_id IS NOT NULL LIMIT 5",
            ),
            database.getAll<{ id: string; minutes: number; ht_centimes: number }>(
              "SELECT id, minutes, ht_centimes FROM temps_saisis",
            ),
            database.getAll<{ temps_id: string | null }>(
              "SELECT temps_id FROM brouillons_facture WHERE numero IS NOT NULL",
            ),
          ]);
          const parId = new Map(dossiers.map((dossier) => [dossier.id, dossier]));
          const chemiseDe = (id: string) => {
            const dossier = parId.get(id);
            if (!dossier || !isChemiseId(dossier.chemise)) return undefined;
            return { nom: dossier.nom, chemise: dossier.chemise, reference: dossier.reference };
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
          const journee = {
            audiences: duJour.map((ligne) => {
              const dossier = chemiseDe(ligne.dossier_id);
              const quand = composantesAffichees(ligne.debut);
              const heure =
                quand && quand.heure !== null && quand.minute !== null
                  ? libelleHeure(quand.heure, quand.minute)
                  : undefined;
              const tache = ligne.type_element === "tache";
              return {
                id: ligne.id,
                titre: ligne.titre,
                meta: tache ? "À faire aujourd'hui" : "",
                heure: tache ? undefined : heure,
                tache,
                dossier: dossier
                  ? { nom: dossier.nom, chemise: dossier.chemise, reference: dossier.reference }
                  : undefined,
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
                const quand = composantesAffichees(ligne.debut);
                const affiche = quand ? delaiAffiche(aujourd, quand.jour) : null;
                return ligneDelai({
                  id: ligne.id,
                  titre: ligne.titre,
                  origineCalcul: ligne.origine_calcul,
                  jours: affiche?.jours ?? null,
                  dateLibelle: affiche?.libelle,
                  dossierNom: dossier?.nom,
                  reference: dossier?.reference,
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
                extrait: ligne.extrait_texte,
                suggestionDossierId: suggere,
                dossierNom: dossier?.nom,
                reference: dossier?.reference,
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
                  reference: dossier?.reference,
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
                    reference: dossier?.reference,
                    chemise: dossier?.chemise,
                  });
                }),
            ],
            nonFacture: saisies.reduce(
              (total, ligne) => {
                if (factures.some((facture) => facture.temps_id === ligne.id)) return total;
                return {
                  minutes: total.minutes + ligne.minutes,
                  htCentimes: total.htCentimes + ligne.ht_centimes,
                };
              },
              { minutes: 0, htCentimes: 0 },
            ),
          } satisfies DonneesJournee;
          return {
            journee,
            dossiers: dossiers.map((dossier) => ({ id: dossier.id, nom: dossier.nom })),
          };
        })
        .then((suivant) => {
          if (stop) return;
          setReelles(suivant.journee);
          setDossiersSync(suivant.dossiers);
        })
        .catch(() => {
          if (!stop) {
            setReelles({ audiences: [], delais: [], mails: [], temps: [], nonFacture: { minutes: 0, htCentimes: 0 } });
          }
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
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--font-size-journee)] font-extrabold text-texte-sur-neutre">
            {fr("La journée")}
          </h1>
          <p className="text-graphite">
            {fr(`${formatDateLongue(jeu?.jourPage ?? jourCivil(new Date()))} ${(jeu?.jourPage ?? jourCivil(new Date())).slice(0, 4)}`)}
          </p>
        </div>
        <p className="font-bold text-encre" data-testid="journee-prochain">
          {fr(
            libelleProchainRendezVous(
              new Date().getHours() * 60 + new Date().getMinutes(),
              audiences.flatMap((ligne) => {
                if (ligne.tache || !ligne.heure) return [];
                const minutes = minutesDepuisLibelle(ligne.heure);
                return minutes === null ? [] : [minutes];
              }),
            ),
          )}
        </p>
      </div>
      <Feuille uneColonne className="min-h-[420px]">
        <div className="grid gap-8 p-[22px] pb-24 md:grid-cols-2">
          <Section
            id="audiences"
            titre="Aujourd'hui"
            lignes={audiences}
            vide="Aucune audience ni rendez-vous aujourd'hui."
            lien="Ouvrir l'agenda"
            onLien={onOuvrirAgenda}
            faites={faites}
            onBasculerTache={basculerTache}
          />
          <Section
            id="delais"
            titre="Délais"
            lignes={delais}
            vide="Aucun délai à surveiller pour le moment."
            lien="Voir tous les délais"
            onLien={onOuvrirAgenda}
          />
          <Section
            id="mails"
            titre="Mails à classer"
            lignes={mails}
            vide="Aucun mail en attente de classement."
            lien="Ouvrir les mails"
            onLien={onNouveauMail}
            onClasser={classer}
            dossiersChoix={dossiersChoix}
            choixOuvert={choixOuvert}
            onAutre={setChoixOuvert}
            onAnnulerChoix={() => {
              setChoixOuvert(null);
            }}
          />
          <Section
            id="temps"
            titre="Temps à saisir"
            lignes={temps}
            vide="Aucun temps en attente de saisie."
            lien="Ouvrir le temps"
            onLien={onSaisirTemps}
            onSaisir={onSaisirTemps}
            annonce={
              <p className="mb-2 flex flex-wrap items-baseline gap-3" data-testid="journee-non-facture">
                <span>
                  {fr(
                    `Non facturé : ${formatDuree(nonFacture.minutes * 60)}, soit ${formatMontant(nonFacture.htCentimes)} HT`,
                  )}
                </span>
                <button
                  type="button"
                  className="font-bold text-encre"
                  onClick={onOuvrirFacturation ?? onSaisirTemps}
                >
                  {fr("Ce qui reste à facturer")}
                </button>
              </p>
            }
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
