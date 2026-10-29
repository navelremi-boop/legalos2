import { useEffect, useMemo, useState } from "react";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
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
      className="fond-neutre relative flex h-full min-h-0 flex-col ecran"
      data-testid="ecran-temps"
      data-fond="neutre"
    >
      <header className="ecran-tete">
        <div>
          <h1 className="ecran-tete__titre">{fr("Temps")}</h1>
          <p className="ecran-tete__sous-titre">
            {fr(
              `${formatDuree(lignes.filter((ligne) => ligne.jour === aujourdhui).reduce((total, ligne) => total + ligne.minutes, 0) * 60)} saisies aujourd'hui, ${formatDuree(volet.nonFactureMinutes * 60)} non facturées`,
            )}
          </p>
        </div>
        {dossierChrono?.chemise ? (
          <p className="ecran-tete__aside">
            <span className="mails-dos" data-testid="temps-chrono-entete" data-chemise={dossierChrono.chemise}>
              <i aria-hidden />
              {fr(`${etatChrono} sur ${libelleReferenceDossier(dossierChrono.reference)}`)}
            </span>
          </p>
        ) : null}
      </header>
      <Feuille uneColonne className="min-h-[420px]">
        <div className="temps-grille">
          <div className="temps-principal">
            <div className="temps-haut">
              <section className="temps-chrono" aria-label={fr("Chronomètre")} data-testid="temps-chrono" data-phase={chrono.phase}>
                <h2 className="feuille-sous-titre">{fr(etatChrono)}</h2>
                <p className="temps-chrono__duree">{formatDuree(chrono.secondes)}</p>
                <div className="flex min-h-6 flex-wrap items-center gap-2">
                  {dossierChrono?.chemise ? (
                    <span className="mails-dos" data-testid="chrono-dossier" data-chemise={dossierChrono.chemise}>
                      <i aria-hidden />
                      {fr(libelleReferenceDossier(dossierChrono.reference))}
                    </span>
                  ) : null}
                  {chrono.libelle !== "" ? <span>{fr(chrono.libelle)}</span> : null}
                </div>
                {chrono.phase === "arrete" ? (
                  <div className="formulaire-actions">
                    <button
                      type="button"
                      className="bouton bouton--prim"
                      data-testid="chrono-demarrer"
                      onClick={() => {
                        onChrono(demarrerChrono(dossierIdPrefere ?? ""));
                      }}
                    >
                      {fr("Démarrer")}
                    </button>
                  </div>
                ) : null}
                {chrono.phase === "en-cours" || chrono.phase === "pause" ? (
                  <div className="formulaire-actions">
                    <button
                      type="button"
                      className="bouton bouton--prim"
                      data-testid="chrono-pause"
                      onClick={() => {
                        onChrono(basculerPause(chrono));
                      }}
                    >
                      {fr(chrono.phase === "pause" ? "Reprendre" : "Pause")}
                    </button>
                    <button
                      type="button"
                      className="bouton"
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
                  <div className="mt-3">
                    <p data-testid="chrono-confirmation">
                      {fr(`Enregistrer ${formatDuree(minutesArret * 60)} ?`)}
                    </p>
                    <div className="formulaire-actions">
                      <button
                        type="button"
                        className="bouton bouton--prim"
                        data-testid="chrono-enregistrer"
                        onClick={() => {
                          void enregistrerChrono();
                        }}
                      >
                        {fr("Enregistrer")}
                      </button>
                      <button
                        type="button"
                        className="bouton"
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

            <section className="temps-saisies">
              <div className="temps-saisies__tete">
                <h2 className="feuille-titre">{fr("Saisies")}</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="filtres" role="group" aria-label={fr("Filtrer les saisies")}>
                    {FILTRES.map((entree) => (
                      <button
                        key={entree.id}
                        type="button"
                        className="filtre"
                        aria-pressed={filtre === entree.id}
                        data-testid={`temps-filtre-${entree.id}`}
                        onClick={() => {
                          setFiltre(entree.id);
                        }}
                      >
                        {fr(entree.label)}
                      </button>
                    ))}
                  </div>
                  <div className="segment" role="group" aria-label={fr("Saisies affichées")}>
                    <button
                      type="button"
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
                      aria-pressed={perimetre === "moi"}
                      data-testid="temps-perimetre-moi"
                      onClick={() => {
                        setPerimetre("moi");
                      }}
                    >
                      {fr("Mes temps")}
                    </button>
                  </div>
                </div>
              </div>
              <p className="mb-3 text-[length:var(--font-size-dense)] text-graphite" data-testid="temps-resume">
                {fr(
                  `${formatDuree(resume.nonFactureMinutes * 60)} non facturées, ${formatDuree(resume.septJoursMinutes * 60)} sur sept jours`,
                )}
              </p>
              <ul data-testid="temps-liste">
                {groupes.length === 0 ? <li className="etat-vide">{fr("Aucune saisie pour ce filtre.")}</li> : null}
                {groupes.map((groupe) => (
                  <li key={groupe.jour} className="temps-jour">
                    <h3 className="temps-jour__titre">
                      <span>{fr(formatDateLongue(groupe.jour))}</span>
                      <span className="text-graphite">{formatDuree(groupe.minutes * 60)}</span>
                    </h3>
                    <ul>
                      {groupe.saisies.map((ligne) => (
                        <li key={ligne.id} className="temps-ligne" data-facturee={ligne.facturee ? "true" : "false"}>
                          <span className="temps-ligne__ref">
                            {ligne.chemise ? (
                              <span className="mails-dos" data-testid="temps-pastille" data-chemise={ligne.chemise}>
                                <i aria-hidden />
                                {fr(libelleReferenceDossier(ligne.reference))}
                              </span>
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-bold">{fr(ligne.libelle)}</span>
                            {ligne.dossierNom !== "" || ligne.intervenantNom ? (
                              <span className="block truncate text-[length:var(--font-size-dense)] text-graphite">
                                {fr(
                                  [ligne.dossierNom, ligne.intervenantNom ?? ""].filter((partie) => partie !== "").join(", "),
                                )}
                              </span>
                            ) : null}
                          </span>
                          <span className="montant">{formatDuree(ligne.minutes * 60)}</span>
                          <span className="montant">
                            {formatMontant(ligne.htCentimes)}
                            <span className="block text-[length:var(--font-size-meta)] text-graphite" data-testid="temps-taux">
                              {fr(`${formatMontant(ligne.tauxCentimesHeure)} par h`)}
                            </span>
                          </span>
                          <span className="temps-ligne__statut" data-etat={ligne.facturee ? "facture" : "a-facturer"}>
                            {ligne.facturee ? fr("Facturé") : fr("Non facturé")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="temps-volet" data-testid="temps-volet">
            <p className="feuille-sous-titre">{fr("Non facturé")}</p>
            <p className="temps-volet__total">{formatDuree(volet.nonFactureMinutes * 60)}</p>
            <p>{fr(`${formatMontant(volet.nonFactureCentimes)} HT`)}</p>
            <button
              type="button"
              className="lien-action mt-2"
              onClick={() => {
                onFacturer?.();
              }}
            >
              {fr("Voir ce qui reste à facturer")}
            </button>
            <h2 className="feuille-sous-titre mt-6 mb-2">{fr("Sept derniers jours")}</h2>
            <ul className="temps-barres" data-testid="temps-sept-jours">
              {volet.jours.map((jour) => {
                const plafond = Math.max(1, ...volet.jours.map((autre) => autre.minutes));
                const hauteur = Math.round((jour.minutes / plafond) * 56);
                return (
                  <li key={jour.jour} className="temps-barres__jour">
                    <span
                      className="temps-barres__barre"
                      style={{ height: Math.max(2, hauteur) }}
                      title={formatDuree(jour.minutes * 60)}
                    />
                    <span className="temps-barres__date">{fr(formatDateCourte(jour.jour).split(" ")[0] ?? "")}</span>
                  </li>
                );
              })}
            </ul>
            <h2 className="feuille-sous-titre mt-6 mb-2">{fr("Par dossier, non facturé")}</h2>
            <ul className="space-y-2" data-testid="temps-par-dossier">
              {volet.dossiers.length === 0 ? (
                <li className="text-graphite">{fr("Rien à facturer.")}</li>
              ) : (
                volet.dossiers.map((dossier) => (
                  <li key={dossier.id} className="temps-volet__dossier">
                    <span className="min-w-0">
                      {dossier.chemise ? (
                        <span className="mails-dos" data-chemise={dossier.chemise}>
                          <i aria-hidden />
                          {fr(libelleReferenceDossier(dossier.reference))}
                        </span>
                      ) : null}
                      <span className="mt-1 block truncate text-[length:var(--font-size-dense)]">{fr(dossier.nom)}</span>
                    </span>
                    <span className="montant text-[length:var(--font-size-dense)]">
                      {formatDuree(dossier.minutes * 60)}
                      <span className="block font-bold">{formatMontant(dossier.centimes)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
            <p className="mt-6 text-[length:var(--font-size-meta)] text-graphite">
              {fr("Le taux est figé à la saisie.")}
            </p>
          </aside>
        </div>
      </Feuille>
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
