import { useEffect, useMemo, useState } from "react";
import { BarreActions } from "@/coque/BarreActions";
import { FormulaireTemps } from "@/facturation/FormulaireTemps";
import {
  basculerPause,
  chronoArrete,
  demarrerChrono,
  demanderArret,
  minutesConfirmees,
  reprendreChrono,
  libellePhaseChrono,
  type EtatChrono,
} from "@/facturation/chronoTemps";
import { enregistrerTemps, tauxHoraireParDefaut } from "@/facturation/ecrireTemps";
import {
  filtrerSaisies,
  grouperParJour,
  resumeTemps,
  voletTemps,
  type FiltreSaisie,
  type PerimetreSaisie,
  type SaisieTemps,
} from "@/facturation/listeTemps";
import { isChemiseId } from "@/lib/chemise";
import { libelleReferenceDossier } from "@/lib/referenceDossier";
import { formatDateCourte, formatDateLongue, formatDuree, formatMontant } from "@/lib/format";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

type EcranTempsProps = {
  instanceUrl: string;
  dossierIdPrefere?: string | null;
  moiId: string | null;
  chrono: EtatChrono;
  onChrono: (etat: EtatChrono) => void;
  onFacturer?: () => void;
  /** Galerie : liste fixe, sans lecture de la base. */
  lignesFixes?: SaisieTemps[];
};

type LigneSql = {
  id: string;
  cree_le: string;
  minutes: number;
  libelle: string;
  dossier_id: string;
  intervenant_id: string;
  taux_centimes_heure: number;
  ht_centimes: number;
  dossier_nom: string | null;
  dossier_chemise: string | null;
  dossier_reference: string | null;
  intervenant_nom: string | null;
};

const FILTRES: { id: FiltreSaisie; label: string }[] = [
  { id: "toutes", label: "Toutes" },
  { id: "non-facturees", label: "Non facturées" },
  { id: "facturees", label: "Facturées" },
];

export function EcranTemps({
  instanceUrl,
  dossierIdPrefere,
  moiId,
  chrono,
  onChrono,
  onFacturer,
  lignesFixes,
}: EcranTempsProps) {
  const [lignesSync, setLignesSync] = useState<SaisieTemps[]>([]);
  const lignes = lignesFixes ?? lignesSync;
  const [filtre, setFiltre] = useState<FiltreSaisie>("toutes");
  const [perimetre, setPerimetre] = useState<PerimetreSaisie>("cabinet");
  const [message, setMessage] = useState("");
  const aujourdhui = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (lignesFixes) return;
    let stop = false;
    const charger = () => {
      void getPowerSyncDatabase()
        .then(async (database) => {
          const temps = await database.getAll<LigneSql>(
            `SELECT t.id, t.cree_le, t.minutes, t.libelle, t.dossier_id, t.intervenant_id,
                    t.taux_centimes_heure, t.ht_centimes, d.nom AS dossier_nom,
                    d.chemise AS dossier_chemise, d.reference AS dossier_reference,
                    u.display_name AS intervenant_nom
             FROM temps_saisis t
             LEFT JOIN dossiers d ON d.id = t.dossier_id
             LEFT JOIN users u ON u.id = t.intervenant_id`,
          );
          const factures = await database.getAll<{ temps_id: string }>(
            "SELECT temps_id FROM brouillons_facture WHERE numero IS NOT NULL",
          );
          const facturesIds = new Set(factures.map((ligne) => ligne.temps_id));
          return temps.map((ligne) => ({
            id: ligne.id,
            jour: ligne.cree_le.slice(0, 10),
            minutes: ligne.minutes,
            libelle: ligne.libelle,
            dossierId: ligne.dossier_id,
            dossierNom: ligne.dossier_nom ?? "",
            chemise:
              ligne.dossier_chemise !== null && isChemiseId(ligne.dossier_chemise)
                ? ligne.dossier_chemise
                : undefined,
            reference: ligne.dossier_reference,
            intervenantId: ligne.intervenant_id,
            intervenantNom: ligne.intervenant_nom ?? undefined,
            tauxCentimesHeure: ligne.taux_centimes_heure,
            htCentimes: ligne.ht_centimes,
            facturee: facturesIds.has(ligne.id),
          }));
        })
        .then((saisies) => {
          if (!stop) setLignesSync(saisies);
        })
        .catch(() => {
          if (!stop) setLignesSync([]);
        });
    };
    charger();
    const timer = window.setInterval(charger, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [lignesFixes]);

  const visibles = useMemo(
    () => filtrerSaisies(lignes, filtre, perimetre, moiId),
    [lignes, filtre, perimetre, moiId],
  );
  const groupes = useMemo(() => grouperParJour(visibles), [visibles]);
  const resume = useMemo(() => resumeTemps(lignes, aujourdhui), [lignes, aujourdhui]);
  const volet = useMemo(() => voletTemps(lignes, aujourdhui), [lignes, aujourdhui]);
  const dossierChrono = lignes.find((ligne) => ligne.dossierId === chrono.dossierId && ligne.chemise);
  const minutesArret = minutesConfirmees(chrono);
  const etatChrono = libellePhaseChrono(chrono.phase);

  async function enregistrerChrono() {
    const dossierId = chrono.dossierId ?? dossierIdPrefere ?? "";
    if (dossierId === "") {
      setMessage(fr("Choisissez un dossier pour enregistrer le chronomètre."));
      return;
    }
    const database = await getPowerSyncDatabase();
    const taux = await tauxHoraireParDefaut(database);
    const ecrit = await enregistrerTemps(database, {
      dossierId,
      minutes: minutesArret,
      libelle: chrono.libelle.trim() === "" ? fr("Chronomètre") : chrono.libelle.trim(),
      tauxCentimesHeure: taux,
    });
    if (!ecrit.ok) {
      setMessage(fr(ecrit.message));
      return;
    }
    onChrono(chronoArrete());
    setMessage(fr(`${formatDuree(minutesArret * 60)} enregistrées.`));
  }

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[30px] pt-[28px]"
      data-testid="ecran-temps"
      data-fond="neutre"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--font-size-journee)] font-extrabold text-sur-chemise">
            {fr("Temps")}
          </h1>
          <p className="text-graphite">
            {fr(
              `${formatDuree(lignes.filter((ligne) => ligne.jour === aujourdhui).reduce((total, ligne) => total + ligne.minutes, 0) * 60)} saisies aujourd'hui, ${formatDuree(volet.nonFactureMinutes * 60)} non facturées`,
            )}
          </p>
        </div>
        {dossierChrono?.chemise ? (
          <p className="mails-dos" data-testid="temps-chrono-entete" data-chemise={dossierChrono.chemise}>
            <i aria-hidden />
            {fr(`${etatChrono} sur ${libelleReferenceDossier(dossierChrono.reference)}`)}
          </p>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 items-stretch grid-cols-[minmax(0,1fr)_17rem] gap-4 overflow-hidden pb-16">
        <div className="min-h-0 space-y-6 overflow-y-auto">
        <div className="grid gap-6 md:grid-cols-2">
        <section aria-label={fr("Chronomètre")} data-testid="temps-chrono" data-phase={chrono.phase}>
          <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
            {fr(etatChrono)}
          </h2>
          <p className="text-[length:var(--font-size-journee)] font-extrabold">
            {formatDuree(chrono.secondes)}
          </p>
          {dossierChrono?.chemise ? (
            <span className="mails-dos" data-testid="chrono-dossier" data-chemise={dossierChrono.chemise}>
              <i aria-hidden />
              {fr(libelleReferenceDossier(dossierChrono.reference))}
            </span>
          ) : null}
          {chrono.libelle !== "" ? <p>{fr(chrono.libelle)}</p> : null}
          {chrono.phase === "arrete" ? (
            <button
              type="button"
              className="mt-2 rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
              data-testid="chrono-demarrer"
              onClick={() => {
                onChrono(demarrerChrono(dossierIdPrefere ?? ""));
              }}
            >
              {fr("Démarrer")}
            </button>
          ) : null}
          {chrono.phase === "en-cours" || chrono.phase === "pause" ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
                data-testid="chrono-pause"
                onClick={() => {
                  onChrono(basculerPause(chrono));
                }}
              >
                {fr(chrono.phase === "pause" ? "Reprendre" : "Pause")}
              </button>
              <button
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
                data-testid="chrono-arreter"
                onClick={() => {
                  onChrono(demanderArret(chrono));
                }}
              >
                {fr("Arrêter")}
              </button>
            </div>
          ) : null}
          {chrono.phase === "confirmation" ? (
            <div className="mt-2">
              <p data-testid="chrono-confirmation">
                {fr(`Enregistrer ${formatDuree(minutesArret * 60)} ?`)}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
                  data-testid="chrono-enregistrer"
                  onClick={() => {
                    void enregistrerChrono();
                  }}
                >
                  {fr("Enregistrer")}
                </button>
                <button
                  type="button"
                  className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
                  data-testid="chrono-reprendre"
                  onClick={() => {
                    onChrono(reprendreChrono(chrono));
                  }}
                >
                  {fr("Reprendre")}
                </button>
              </div>
            </div>
          ) : null}
          {message !== "" ? <p className="mt-2 text-graphite">{message}</p> : null}
        </section>

        <FormulaireTemps instanceUrl={instanceUrl} dossierIdPrefere={dossierIdPrefere} />
        </div>

        <section>
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={fr("Filtrer les saisies")}>
            {FILTRES.map((entree) => (
              <button
                key={entree.id}
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                aria-pressed={filtre === entree.id}
                data-testid={`temps-filtre-${entree.id}`}
                onClick={() => {
                  setFiltre(entree.id);
                }}
              >
                {fr(entree.label)}
              </button>
            ))}
            <button
              type="button"
              className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
              aria-pressed={perimetre === "cabinet"}
              data-testid="temps-perimetre-cabinet"
              onClick={() => {
                setPerimetre("cabinet");
              }}
            >
              {fr("Le cabinet")}
            </button>
            <button
              type="button"
              className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
              aria-pressed={perimetre === "moi"}
              data-testid="temps-perimetre-moi"
              onClick={() => {
                setPerimetre("moi");
              }}
            >
              {fr("Mes temps")}
            </button>
          </div>
          <p className="mb-3 text-graphite" data-testid="temps-resume">
            {fr(
              `${formatDuree(resume.nonFactureMinutes * 60)} non facturées, ${formatDuree(resume.septJoursMinutes * 60)} sur sept jours`,
            )}
          </p>
          <ul data-testid="temps-liste">
            {groupes.map((groupe) => (
              <li key={groupe.jour} className="mb-4">
                <h3 className="font-extrabold">
                  {formatDateLongue(groupe.jour)} <span className="text-graphite">{formatDuree(groupe.minutes * 60)}</span>
                </h3>
                <ul>
                  {groupe.saisies.map((ligne) => (
                    <li key={ligne.id} className="flex items-baseline justify-between gap-3 py-1" data-facturee={ligne.facturee ? "true" : "false"}>
                      <span className="flex min-w-0 items-baseline gap-2">
                        {ligne.chemise ? (
                          <span className="mails-dos" data-testid="temps-pastille" data-chemise={ligne.chemise}>
                            <i aria-hidden />
                            {fr(libelleReferenceDossier(ligne.reference))}
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate">
                          <span className="block truncate">{fr(ligne.libelle)}</span>
                          {ligne.dossierNom !== "" || ligne.intervenantNom ? (
                            <span className="block truncate text-graphite">
                              {fr(
                                [ligne.dossierNom, ligne.intervenantNom ?? ""].filter((partie) => partie !== "").join(", "),
                              )}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="text-right">
                        {formatDuree(ligne.minutes * 60)} {formatMontant(ligne.htCentimes)}
                        <span className="block text-graphite" data-testid="temps-taux">
                          {fr(`${formatMontant(ligne.tauxCentimesHeure)} par h`)}
                        </span>
                        {ligne.facturee ? fr(" Facturé") : fr(" Non facturé")}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
        </div>
        <aside className="min-h-0 overflow-y-auto border-l border-filet pl-4" data-testid="temps-volet">
          <p className="text-[length:var(--font-size-section)] font-extrabold">
            {formatDuree(volet.nonFactureMinutes * 60)}
          </p>
          <p>{fr(`${formatMontant(volet.nonFactureCentimes)} HT`)}</p>
          <button
            type="button"
            className="my-3 font-bold text-encre"
            onClick={() => {
              onFacturer?.();
            }}
          >
            {fr("Voir ce qui reste à facturer")}
          </button>
          <h2 className="mb-1 font-extrabold">{fr("Sept derniers jours")}</h2>
          <ul className="mb-4 flex items-end gap-1" data-testid="temps-sept-jours">
            {volet.jours.map((jour) => {
              const plafond = Math.max(1, ...volet.jours.map((autre) => autre.minutes));
              const hauteur = Math.round((jour.minutes / plafond) * 48);
              return (
                <li key={jour.jour} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span
                    className="w-full bg-encre"
                    style={{ height: hauteur }}
                    title={formatDuree(jour.minutes * 60)}
                  />
                  <span className="text-[length:var(--font-size-meta)] text-graphite">{formatDateCourte(jour.jour)}</span>
                </li>
              );
            })}
          </ul>
          <h2 className="mb-1 font-extrabold">{fr("Par dossier, non facturé")}</h2>
          <ul data-testid="temps-par-dossier">
            {volet.dossiers.length === 0 ? (
              <li className="text-graphite">{fr("Rien à facturer.")}</li>
            ) : (
              volet.dossiers.map((dossier) => (
                <li key={dossier.id} className="flex justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {dossier.chemise ? (
                      <span className="mails-dos" data-chemise={dossier.chemise}>
                        <i aria-hidden />
                        {fr(libelleReferenceDossier(dossier.reference))}
                      </span>
                    ) : null}
                    <span className="truncate">{fr(dossier.nom)}</span>
                  </span>
                  <span className="text-right">
                    {formatDuree(dossier.minutes * 60)}
                    <span className="block">{formatMontant(dossier.centimes)}</span>
                  </span>
                </li>
              ))
            )}
          </ul>
          <p className="mt-4 text-[length:var(--font-size-meta)] text-graphite">
            {fr("Le taux est figé à la saisie.")}
          </p>
        </aside>
      </div>
      <BarreActions
        actions={[
          {
            id: "saisir-temps",
            label: "Saisir du temps",
            raccourci: "T",
            primaire: true,
            onClick: () => {
              document.getElementById("temps-minutes")?.focus();
            },
          },
          {
            id: "facturer",
            label: "Facturer",
            onClick: () => {
              onFacturer?.();
            },
          },
        ]}
      />
    </div>
  );
}
