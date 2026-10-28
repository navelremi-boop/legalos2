import { useEffect, useMemo, useState } from "react";
import { FormulaireTemps } from "@/facturation/FormulaireTemps";
import {
  basculerPause,
  chronoArrete,
  demarrerChrono,
  demanderArret,
  minutesConfirmees,
  reprendreChrono,
  type EtatChrono,
} from "@/facturation/chronoTemps";
import { enregistrerTemps, tauxHoraireParDefaut } from "@/facturation/ecrireTemps";
import {
  filtrerSaisies,
  grouperParJour,
  resumeTemps,
  type FiltreSaisie,
  type PerimetreSaisie,
  type SaisieTemps,
} from "@/facturation/listeTemps";
import { formatDuree, formatMontant } from "@/lib/format";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

type EcranTempsProps = {
  instanceUrl: string;
  dossierIdPrefere?: string | null;
  moiId: string | null;
  chrono: EtatChrono;
  onChrono: (etat: EtatChrono) => void;
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
};

const FILTRES: { id: FiltreSaisie; label: string }[] = [
  { id: "toutes", label: "Toutes" },
  { id: "non-facturees", label: "Non facturées" },
  { id: "facturees", label: "Facturées" },
];

export function EcranTemps({ instanceUrl, dossierIdPrefere, moiId, chrono, onChrono }: EcranTempsProps) {
  const [lignes, setLignes] = useState<SaisieTemps[]>([]);
  const [filtre, setFiltre] = useState<FiltreSaisie>("toutes");
  const [perimetre, setPerimetre] = useState<PerimetreSaisie>("cabinet");
  const [message, setMessage] = useState("");
  const aujourdhui = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let stop = false;
    const charger = () => {
      void getPowerSyncDatabase()
        .then(async (database) => {
          const temps = await database.getAll<LigneSql>(
            `SELECT t.id, t.cree_le, t.minutes, t.libelle, t.dossier_id, t.intervenant_id,
                    t.taux_centimes_heure, t.ht_centimes, d.nom AS dossier_nom
             FROM temps_saisis t
             LEFT JOIN dossiers d ON d.id = t.dossier_id`,
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
            intervenantId: ligne.intervenant_id,
            tauxCentimesHeure: ligne.taux_centimes_heure,
            htCentimes: ligne.ht_centimes,
            facturee: facturesIds.has(ligne.id),
          }));
        })
        .then((saisies) => {
          if (!stop) setLignes(saisies);
        })
        .catch(() => {
          if (!stop) setLignes([]);
        });
    };
    charger();
    const timer = window.setInterval(charger, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const visibles = useMemo(
    () => filtrerSaisies(lignes, filtre, perimetre, moiId),
    [lignes, filtre, perimetre, moiId],
  );
  const groupes = useMemo(() => grouperParJour(visibles), [visibles]);
  const resume = useMemo(() => resumeTemps(lignes, aujourdhui), [lignes, aujourdhui]);
  const minutesArret = minutesConfirmees(chrono);

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
    setMessage(fr(`${String(minutesArret)} min enregistrées.`));
  }

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[30px] pt-[28px]"
      data-testid="ecran-temps"
      data-fond="neutre"
    >
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-sur-chemise">
        {fr("Temps")}
      </h1>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-16">
        <section aria-label={fr("Chronomètre")} data-testid="temps-chrono" data-phase={chrono.phase}>
          <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
            {fr(chrono.phase === "pause" ? "Chronomètre, en pause" : "Chronomètre")}
          </h2>
          <p className="text-[length:var(--font-size-journee)] font-extrabold tabular-nums">
            {formatDuree(chrono.secondes)}
          </p>
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
                {fr(`Enregistrer ${String(minutesArret)} min ?`)}
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
              `${String(resume.nonFactureMinutes)} min non facturées, ${String(resume.septJoursMinutes)} min sur sept jours`,
            )}
          </p>
          <ul data-testid="temps-liste">
            {groupes.map((groupe) => (
              <li key={groupe.jour} className="mb-4">
                <h3 className="font-extrabold">
                  {fr(groupe.jour)} <span className="text-graphite">{formatDuree(groupe.minutes * 60)}</span>
                </h3>
                <ul>
                  {groupe.saisies.map((ligne) => (
                    <li key={ligne.id} className="flex items-baseline justify-between gap-3 py-1" data-facturee={ligne.facturee ? "true" : "false"}>
                      <span>
                        {fr(ligne.libelle)}
                        {ligne.dossierNom !== "" ? fr(` — ${ligne.dossierNom}`) : ""}
                      </span>
                      <span>
                        {formatDuree(ligne.minutes * 60)} {formatMontant(ligne.htCentimes)}
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
    </div>
  );
}
