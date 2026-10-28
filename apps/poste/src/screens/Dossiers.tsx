import { useEffect, useMemo, useState } from "react";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { FormulaireDossier } from "@/dossiers/FormulaireDossier";
import { derniersElements, etapesProcedure, resumeFacturation, type ElementRecent } from "@/dossiers/apercuDossier";
import { libelleEtapeDossier, libelleTypeDossier } from "@/dossiers/libellesDossier";
import {
  compteurs,
  filtrer,
  grouper,
  panneauDroit,
  vueDossier,
  type DossierBrut,
  type FiltreDossier,
  type TriDossier,
} from "@/dossiers/listeDossiers";
import { fr } from "@/lib/fr";
import { formatDateCourte, formatDuree, formatMontant } from "@/lib/format";
import { libelleReferenceDossier } from "@/lib/referenceDossier";
import { getPowerSyncDatabase } from "@/sync/database";

type LigneDossier = {
  id: string;
  nom: string;
  chemise: string;
  reference: string | null;
  type_dossier?: string | null;
  etape?: string | null;
  juridiction?: string | null;
  numero_rg?: string | null;
  restreint?: number | null;
  cree_le?: string | null;
};

type EcheanceLocale = {
  dossier_id: string;
  titre: string | null;
  debut: string | null;
};

type PartieLocale = {
  dossier_id: string;
  nom: string | null;
  role: string | null;
};

type DossiersProps = {
  onOuvrirDossier?: (id: string, nom: string, chemise: string, reference?: string | null) => void;
  onNouveauDossier?: () => void;
  onNouveauMail?: () => void;
  onSaisirTemps?: () => void;
  /** Galerie : liste fixe, sans PowerSync. */
  lignesFixes?: LigneDossier[];
};

const FILTRES: { id: FiltreDossier; label: string }[] = [
  { id: "actifs", label: "Actifs" },
  { id: "proche", label: "Échéance proche" },
  { id: "restreints", label: "Restreints" },
  { id: "clos", label: "Clos" },
];

function aujourdhuiIso(maintenant = new Date()): string {
  const mois = String(maintenant.getMonth() + 1).padStart(2, "0");
  const jour = String(maintenant.getDate()).padStart(2, "0");
  return `${String(maintenant.getFullYear())}-${mois}-${jour}`;
}

function versBrut(
  ligne: LigneDossier,
  echeances: Map<string, { debut: string; titre: string | null }>,
  parties: Map<string, string>,
): DossierBrut {
  const echeance = echeances.get(ligne.id);
  return {
    id: ligne.id,
    nom: ligne.nom,
    chemise: ligne.chemise,
    reference: ligne.reference,
    typeDossier: ligne.type_dossier ?? null,
    etape: ligne.etape ?? null,
    juridiction: ligne.juridiction ?? null,
    numeroRg: ligne.numero_rg ?? null,
    restreint: ligne.restreint === 1,
    creeLe: ligne.cree_le ?? null,
    echeance: echeance?.debut ?? null,
    echeanceTitre: echeance?.titre ?? null,
    parties: parties.get(ligne.id) ?? "",
  };
}

export function Dossiers({
  onOuvrirDossier,
  onNouveauMail,
  onSaisirTemps,
  lignesFixes,
}: DossiersProps) {
  const [lignesSync, setLignesSync] = useState<LigneDossier[]>([]);
  const [echeances, setEcheances] = useState<Map<string, { debut: string; titre: string | null }>>(
    () => new Map(),
  );
  const [parties, setParties] = useState<Map<string, string>>(() => new Map());
  const [recents, setRecents] = useState<Map<string, ElementRecent[]>>(() => new Map());
  const [facturation, setFacturation] = useState<
    Map<string, { nonFactureMinutes: number; factureCentimes: number }>
  >(() => new Map());
  const [filtre, setFiltre] = useState<FiltreDossier>("actifs");
  const [tri, setTri] = useState<TriDossier>("echeance");
  const [recherche, setRecherche] = useState("");
  const [creation, setCreation] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const jour = aujourdhuiIso();

  useEffect(() => {
    if (lignesFixes) return;
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then(async (database) => {
          const [dossiers, agendas, roles, mails, pieces, temps, factures] = await Promise.all([
            database.getAll<LigneDossier>(
              `SELECT id, nom, chemise, reference, type_dossier, etape, juridiction, numero_rg, restreint, cree_le
               FROM dossiers`,
            ),
            database.getAll<EcheanceLocale>(
              "SELECT dossier_id, titre, debut FROM agenda_elements WHERE debut IS NOT NULL",
            ),
            database.getAll<PartieLocale>("SELECT dossier_id, nom, role FROM parties"),
            database.getAll<{ id: string; dossier_id: string; objet: string | null; cree_le: string | null }>(
              "SELECT id, dossier_id, objet, cree_le FROM messages WHERE dossier_id IS NOT NULL",
            ),
            database.getAll<{ id: string; dossier_id: string; nom: string | null; cree_le: string | null }>(
              "SELECT id, dossier_id, nom, cree_le FROM documents WHERE dossier_id IS NOT NULL",
            ),
            database.getAll<{ id: string; dossier_id: string; minutes: number; ht_centimes: number }>(
              "SELECT id, dossier_id, minutes, ht_centimes FROM temps_saisis",
            ),
            database.getAll<{ temps_id: string | null }>(
              "SELECT temps_id FROM brouillons_facture WHERE numero IS NOT NULL",
            ),
          ]);
          return { dossiers, agendas, roles, mails, pieces, temps, factures };
        })
        .then(({ dossiers, agendas, roles, mails, pieces, temps, factures }) => {
          if (stop) return;
          const prochaines = new Map<string, { debut: string; titre: string | null }>();
          for (const ligne of agendas) {
            if (!ligne.debut || ligne.debut.slice(0, 10) < jour) continue;
            const deja = prochaines.get(ligne.dossier_id);
            if (!deja || ligne.debut < deja.debut) {
              prochaines.set(ligne.dossier_id, { debut: ligne.debut, titre: ligne.titre });
            }
          }
          const noms = new Map<string, string[]>();
          for (const role of roles) {
            const nom = role.nom?.trim() ?? "";
            if (nom === "") continue;
            const liste = noms.get(role.dossier_id) ?? [];
            liste.push(role.role ? `${role.role} ${nom}` : nom);
            noms.set(role.dossier_id, liste);
          }
          const texte = new Map<string, string>();
          for (const [id, liste] of noms) texte.set(id, liste.join(" "));
          const parDossier = new Map<string, ElementRecent[]>();
          const ajouter = (dossierId: string, element: ElementRecent) => {
            const liste = parDossier.get(dossierId) ?? [];
            liste.push(element);
            parDossier.set(dossierId, liste);
          };
          for (const mail of mails) {
            ajouter(mail.dossier_id, {
              id: mail.id,
              genre: "mail",
              titre: mail.objet ?? "",
              quand: mail.cree_le ?? "",
            });
          }
          for (const piece of pieces) {
            ajouter(piece.dossier_id, {
              id: piece.id,
              genre: "piece",
              titre: piece.nom ?? "",
              quand: piece.cree_le ?? "",
            });
          }
          const facturesIds = new Set(factures.map((ligne) => ligne.temps_id).filter((id): id is string => id !== null));
          const parFacturation = new Map<string, { minutes: number; htCentimes: number; facture: boolean }[]>();
          for (const ligne of temps) {
            const liste = parFacturation.get(ligne.dossier_id) ?? [];
            liste.push({
              minutes: ligne.minutes,
              htCentimes: ligne.ht_centimes,
              facture: facturesIds.has(ligne.id),
            });
            parFacturation.set(ligne.dossier_id, liste);
          }
          const resumes = new Map<string, { nonFactureMinutes: number; factureCentimes: number }>();
          for (const [id, liste] of parFacturation) resumes.set(id, resumeFacturation(liste));
          const recentsTries = new Map<string, ElementRecent[]>();
          for (const [id, liste] of parDossier) recentsTries.set(id, derniersElements(liste));
          setLignesSync(dossiers);
          setEcheances(prochaines);
          setParties(texte);
          setRecents(recentsTries);
          setFacturation(resumes);
        })
        .catch(() => {
          if (!stop) setLignesSync([]);
        });
    };
    tick();
    const timer = window.setInterval(tick, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [lignesFixes, jour]);

  const vues = useMemo(() => {
    const source = lignesFixes ?? lignesSync;
    return source.map((ligne) => versBrut(ligne, echeances, parties)).map((brut) => vueDossier(brut, jour));
  }, [lignesFixes, lignesSync, echeances, parties, jour]);

  const nombres = useMemo(() => compteurs(vues), [vues]);
  const visibles = useMemo(() => filtrer(vues, filtre, recherche), [vues, filtre, recherche]);
  const groupes = useMemo(() => grouper(visibles, tri), [visibles, tri]);
  const choisi = visibles.find((dossier) => dossier.id === selection) ?? visibles[0] ?? null;
  const panneau = panneauDroit(creation);

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[30px] pt-[28px]"
      data-testid="ecran-dossiers"
      data-fond="neutre"
    >
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--font-size-journee)] font-extrabold text-sur-chemise">
            {fr("Dossiers")}
          </h1>
          <p className="text-graphite">
            {fr(
              `${String(nombres.actifs)} dossiers actifs, ${String(vues.filter((d) => !d.clos && d.jours !== null && d.jours <= 7).length)} échéances cette semaine`,
            )}
          </p>
        </div>
        <p className="text-[length:var(--font-size-dense)] text-graphite">
          {fr(`${String(nombres.restreints)} dossiers restreints accessibles`)}
        </p>
      </div>
      <Feuille className="min-h-0 flex-1">
        <div className="flex min-h-0 flex-col overflow-hidden p-[22px]">
          <label className="mb-3 block">
            <span className="sr-only">{fr("Rechercher un dossier")}</span>
            <input
              type="search"
              className="w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
              placeholder={fr("Rechercher un dossier : nom, référence, numéro RG, client, adversaire")}
              aria-label={fr("Rechercher un dossier")}
              data-testid="dossiers-recherche"
              value={recherche}
              onChange={(event) => {
                setRecherche(event.target.value);
              }}
            />
          </label>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1" role="group" aria-label={fr("Filtrer les dossiers")}>
              {FILTRES.map((entree) => {
                const presse = recherche.trim() === "" && filtre === entree.id;
                const compte =
                  entree.id === "actifs"
                    ? nombres.actifs
                    : entree.id === "proche"
                      ? nombres.proche
                      : entree.id === "restreints"
                        ? nombres.restreints
                        : nombres.clos;
                return (
                  <button
                    key={entree.id}
                    type="button"
                    className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                    aria-pressed={presse}
                    data-testid={`dossiers-filtre-${entree.id}`}
                    onClick={() => {
                      setFiltre(entree.id);
                      setRecherche("");
                    }}
                  >
                    {fr(entree.label)} <b>{compte}</b>
                  </button>
                );
              })}
            </div>
            <label className="text-graphite">
              {fr("Trier par")}{" "}
              <select
                className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-encre"
                aria-label={fr("Trier les dossiers")}
                data-testid="dossiers-tri"
                value={tri}
                onChange={(event) => {
                  const valeur = event.target.value;
                  if (valeur === "echeance" || valeur === "activite" || valeur === "reference") setTri(valeur);
                }}
              >
                <option value="echeance">{fr("Prochaine échéance")}</option>
                <option value="activite">{fr("Dernière activité")}</option>
                <option value="reference">{fr("Référence")}</option>
              </select>
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="dossiers-liste">
            {visibles.length === 0 ? (
              <p className="text-graphite">
                {recherche.trim() !== ""
                  ? fr("Aucun dossier ne correspond. Essayez un nom, une référence, un numéro RG ou un adversaire.")
                  : fr("Aucun dossier ici. Changez de filtre, ou créez un dossier avec « Nouveau dossier ».")}
              </p>
            ) : (
              groupes.map((groupe) => (
                <section key={groupe.titre || "tous"}>
                  {groupe.titre !== "" ? (
                    <h2 className="mb-2 mt-4 text-[length:var(--font-size-section)] font-extrabold">
                      {fr(groupe.titre)} <span className="text-graphite">{groupe.dossiers.length}</span>
                    </h2>
                  ) : null}
                  <ul className="divide-y divide-filet">
                    {groupe.dossiers.map((ligne) => {
                      const reference = libelleReferenceDossier(ligne.reference);
                      return (
                        <li key={ligne.id}>
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center gap-3 px-2 py-2 text-left hover:bg-survol"
                            data-chemise={ligne.chemise}
                            data-reference={reference}
                            data-testid="liste-dossier"
                            data-dossier-id={ligne.id}
                            data-selected={choisi?.id === ligne.id ? "true" : "false"}
                            onMouseEnter={() => {
                              setSelection(ligne.id);
                            }}
                            onClick={() => {
                              setSelection(ligne.id);
                              onOuvrirDossier?.(ligne.id, ligne.nom, ligne.chemise, ligne.reference);
                            }}
                          >
                            <span
                              className="h-[13px] w-[9px] shrink-0 rounded-[2px] bg-chemise-bande"
                              aria-hidden
                            />
                            <span className="shrink-0 text-[length:var(--font-size-meta)] font-bold text-graphite">
                              {fr(reference)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-bold">{fr(ligne.nom)}</span>
                              <span className="block truncate text-[length:var(--font-size-meta)] text-graphite">
                                <span data-testid="dossier-libelle-type">
                                  {fr(libelleTypeDossier(ligne.typeDossier))}
                                </span>
                                {", "}
                                <span data-testid="dossier-libelle-etape">
                                  {fr(libelleEtapeDossier(ligne.etape))}
                                </span>
                                {ligne.numeroRg ? fr(`, RG ${ligne.numeroRg}`) : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
        <aside className="min-h-0 overflow-y-auto border-l border-filet p-[22px]" aria-live="polite">
          {panneau === "creation" ? (
            <div data-testid="dossiers-creation">
              <button
                type="button"
                className="mb-3 text-graphite"
                data-testid="dossiers-annuler"
                onClick={() => {
                  setCreation(false);
                }}
              >
                {fr("Annuler")}
              </button>
              <FormulaireDossier
                onCree={({ id }) => {
                  setSelection(id);
                }}
              />
            </div>
          ) : choisi ? (
            <div data-testid="dossiers-apercu" data-dossier-id={choisi.id}>
              <p className="text-[length:var(--font-size-meta)] font-bold text-graphite">
                {fr(libelleReferenceDossier(choisi.reference))}
              </p>
              <h2 className="mb-3 text-[length:var(--font-size-section)] font-extrabold">{fr(choisi.nom)}</h2>
              <dl className="mb-4 space-y-1 text-encre">
                <div>
                  <dt className="text-graphite">{fr("Type")}</dt>
                  <dd>{fr(libelleTypeDossier(choisi.typeDossier))}</dd>
                </div>
                <div>
                  <dt className="text-graphite">{fr("Étape")}</dt>
                  <dd>{fr(libelleEtapeDossier(choisi.etape))}</dd>
                </div>
                {choisi.juridiction ? (
                  <div>
                    <dt className="text-graphite">{fr("Juridiction")}</dt>
                    <dd>{fr(choisi.juridiction)}</dd>
                  </div>
                ) : null}
                {choisi.numeroRg ? (
                  <div>
                    <dt className="text-graphite">{fr("N° RG")}</dt>
                    <dd>{fr(choisi.numeroRg)}</dd>
                  </div>
                ) : null}
                {choisi.parties !== "" ? (
                  <div>
                    <dt className="text-graphite">{fr("Parties")}</dt>
                    <dd>{fr(choisi.parties)}</dd>
                  </div>
                ) : null}
              </dl>
              {choisi.restreint ? <p className="mb-3 font-bold">{fr("Dossier restreint")}</p> : null}
              {choisi.jours !== null && choisi.echeance ? (
                <p className="mb-4">
                  {fr(choisi.echeanceTitre ?? "Échéance")}
                  {", "}
                  {formatDateCourte(choisi.echeance)}
                </p>
              ) : choisi.clos ? (
                <p className="mb-4 text-graphite">
                  {fr("Dossier clos. Les pièces, mails et factures restent consultables.")}
                </p>
              ) : (
                <p className="mb-4 text-graphite">{fr("Aucune échéance")}</p>
              )}
              <h3 className="mb-1 font-extrabold">{fr("Procédure")}</h3>
              <ol className="mb-4" data-testid="dossier-procedure">
                {etapesProcedure(choisi.typeDossier, choisi.etape).map((etape) => (
                  <li key={etape.code} data-etat={etape.etat}>
                    {fr(etape.libelle)}
                  </li>
                ))}
              </ol>
              <h3 className="mb-1 font-extrabold">{fr("Derniers éléments")}</h3>
              <ul className="mb-4" data-testid="dossier-recents">
                {(recents.get(choisi.id) ?? []).length === 0 ? (
                  <li className="text-graphite">{fr("Aucun élément récent.")}</li>
                ) : (
                  (recents.get(choisi.id) ?? []).map((element) => (
                    <li key={element.id}>{fr(element.titre)}</li>
                  ))
                )}
              </ul>
              <h3 className="mb-1 font-extrabold">{fr("Temps et facturation")}</h3>
              <p className="mb-4" data-testid="dossier-temps">
                {fr(
                  `${formatDuree((facturation.get(choisi.id)?.nonFactureMinutes ?? 0) * 60)} non facturées, ${formatMontant(facturation.get(choisi.id)?.factureCentimes ?? 0)} facturés`,
                )}
              </p>
              <button
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
                data-testid="dossier-ouvrir"
                onClick={() => {
                  onOuvrirDossier?.(choisi.id, choisi.nom, choisi.chemise, choisi.reference);
                }}
              >
                {fr("Ouvrir le dossier")}
              </button>
            </div>
          ) : (
            <p className="text-graphite">{fr("Aucun dossier à afficher.")}</p>
          )}
        </aside>
      </Feuille>
      {creation ? null : (
        <BarreActions
          actions={[
            {
              id: "nouveau-dossier",
              primaire: true,
              label: "Nouveau dossier",
              testId: "dossiers-nouveau",
              onClick: () => {
                setCreation(true);
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
              raccourci: "T",
              onClick: () => {
                onSaisirTemps?.();
              },
            },
          ]}
        />
      )}
    </div>
  );
}
