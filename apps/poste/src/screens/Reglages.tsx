import { useEffect, useRef, useState } from "react";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";
import {
  analyserPour,
  blocsDepuisTexte,
  estErreurModele,
  MODELE_PAR_DEFAUT,
  type RemiseAZero,
} from "@/lib/modeleReference";
import {
  apercuHorsLigne,
  chargerReferenceCabinet,
  enregistrerReferenceCabinet,
  type ApercuReference,
} from "@/lib/referenceCabinet";
import { clearSession } from "@/lib/session/storage";
import { ConstructeurReference } from "@/screens/ConstructeurReference";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { getPowerSyncDatabase } from "@/sync/database";

export type ThemeMode = "light" | "dark" | "system";

type ReglagesProps = {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onResetSession?: () => void;
  onReconnect?: () => void;
  instanceUrl: string;
  horsLigne: boolean;
  onNouveauDossier?: () => void;
  onNouveauMail?: () => void;
  onSaisirTemps?: () => void;
};

function estRemise(valeur: string): valeur is RemiseAZero {
  return valeur === "annuelle" || valeur === "jamais";
}

export function Reglages({
  themeMode,
  onThemeChange,
  onResetSession,
  onReconnect,
  instanceUrl,
  horsLigne,
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
}: ReglagesProps) {
  const [nom, setNom] = useState("");
  const [slug, setSlug] = useState("");
  const [baseNom, setBaseNom] = useState("");
  const [baseSlug, setBaseSlug] = useState("");
  const [conflits, setConflits] = useState(0);
  const [refusMessage, setRefusMessage] = useState<string | null>(null);
  const [modeleReference, setModeleReference] = useState(MODELE_PAR_DEFAUT);
  const [remiseAZero, setRemiseAZero] = useState<RemiseAZero>("annuelle");
  const [numeroDepart, setNumeroDepart] = useState("");
  const [apercuValeurs, setApercuValeurs] = useState<ApercuReference>(apercuHorsLigne);
  const [messageReference, setMessageReference] = useState("");
  const [numeroDepartMinimal, setNumeroDepartMinimal] = useState<number | null>(null);
  const baseNomRef = useRef("");
  const baseSlugRef = useRef("");

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          Promise.all([
            database.getAll<{ n: number }>(
              "SELECT COUNT(*) AS n FROM journal_modifications WHERE conflit = 1",
            ),
            database.getAll<{ nom: string; slug: string }>(
              "SELECT nom, slug FROM cabinets WHERE id = ? LIMIT 1",
              [DEMO_CABINET_ID],
            ),
            database.getAll<{ message: string }>(
              "SELECT message FROM refus_sync ORDER BY cree_le DESC LIMIT 1",
            ),
          ]),
        )
        .then(([conflitRows, cabinetRows, refusRows]) => {
          if (stop) return;
          setConflits(conflitRows[0]?.n ?? 0);
          setRefusMessage(refusRows[0]?.message ?? null);
          const cabinet = cabinetRows[0];
          if (!cabinet) return;
          const nomBase = baseNomRef.current;
          const slugBase = baseSlugRef.current;
          setNom((courant) => (courant === nomBase ? cabinet.nom : courant));
          setSlug((courant) => (courant === slugBase ? cabinet.slug : courant));
          baseNomRef.current = cabinet.nom;
          baseSlugRef.current = cabinet.slug;
          setBaseNom(cabinet.nom);
          setBaseSlug(cabinet.slug);
        })
        .catch(() => {
          if (!stop) {
            setConflits(0);
            setRefusMessage(null);
          }
        });
    };
    tick();
    const timer = window.setInterval(tick, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    void getPowerSyncDatabase()
      .then((database) =>
        database.getAll<{
          nom: string;
          slug: string;
          reference_modele: string | null;
          reference_remise_a_zero: string | null;
        }>(
          "SELECT nom, slug, reference_modele, reference_remise_a_zero FROM cabinets WHERE id = ? LIMIT 1",
          [DEMO_CABINET_ID],
        ),
      )
      .then((rows) => {
        if (stop || rows.length === 0) return;
        const nomLu = rows[0]?.nom ?? "";
        const slugLu = rows[0]?.slug ?? "";
        setNom(nomLu);
        setSlug(slugLu);
        baseNomRef.current = nomLu;
        baseSlugRef.current = slugLu;
        setBaseNom(nomLu);
        setBaseSlug(slugLu);
        const modeleLu = rows[0]?.reference_modele?.trim() ?? "";
        if (modeleLu.length > 0) setModeleReference(modeleLu);
        const remiseLue = rows[0]?.reference_remise_a_zero ?? "";
        if (estRemise(remiseLue)) setRemiseAZero(remiseLue);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (horsLigne) return;
    let stop = false;
    void chargerReferenceCabinet(instanceUrl, DEMO_CABINET_ID).then((resultat) => {
      if (stop) return;
      if (resultat.ok) {
        setModeleReference(resultat.etat.modele);
        setRemiseAZero(resultat.etat.remise_a_zero);
        setNumeroDepart(
          resultat.etat.numero_depart === null ? "" : String(resultat.etat.numero_depart),
        );
        setApercuValeurs(resultat.etat.apercu);
        setMessageReference("");
      }
    });
    return () => {
      stop = true;
    };
  }, [horsLigne, instanceUrl]);

  const apercuActif = horsLigne ? apercuHorsLigne() : apercuValeurs;
  let apercuTexte = "";
  let erreurModele = "";
  try {
    const modele = analyserPour(modeleReference, remiseAZero);
    apercuTexte = modele.produire(
      apercuActif.annee,
      apercuActif.prochain,
      apercuActif.initiales,
    );
  } catch (err) {
    erreurModele = estErreurModele(err) ? err.message : fr("Modèle invalide.");
  }

  async function enregistrerReference() {
    if (horsLigne) {
      setMessageReference(fr("Modification possible en ligne seulement."));
      setNumeroDepartMinimal(null);
      return;
    }
    const depart = numeroDepart.trim();
    const numero = depart === "" ? null : Number(depart);
    if (depart !== "" && (!Number.isInteger(numero) || (numero ?? 0) < 1)) {
      setMessageReference(fr("Le numéro de départ doit être un entier supérieur ou égal à 1."));
      setNumeroDepartMinimal(null);
      return;
    }
    const resultat = await enregistrerReferenceCabinet(instanceUrl, DEMO_CABINET_ID, {
      modele: modeleReference,
      remise_a_zero: remiseAZero,
      numero_depart: numero,
    });
    if (resultat.ok) {
      setModeleReference(resultat.etat.modele);
      setRemiseAZero(resultat.etat.remise_a_zero);
      setNumeroDepart(
        resultat.etat.numero_depart === null ? "" : String(resultat.etat.numero_depart),
      );
      setApercuValeurs(resultat.etat.apercu);
      setMessageReference(fr("Modèle enregistré."));
      setNumeroDepartMinimal(null);
      return;
    }
    setMessageReference(resultat.message);
    setNumeroDepartMinimal(resultat.numero_depart_minimal);
  }

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[30px] pt-[28px]"
      data-testid="ecran-reglages"
      data-fond="neutre"
    >
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-sur-chemise">
        {fr("Réglages")}
      </h1>
      <Feuille uneColonne className="min-h-[360px]">
        <div className="space-y-6 p-[22px] pb-16">
          <div>
            <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="theme">
              {fr("Thème")}
            </label>
            <select
              id="theme"
              className="mt-1 w-full max-w-xs rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
              value={themeMode}
              onChange={(event) => {
                onThemeChange(event.target.value as ThemeMode);
              }}
            >
              <option value="system">{fr("Système")}</option>
              <option value="light">{fr("Jour")}</option>
              <option value="dark">{fr("Nuit")}</option>
            </select>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formulaire = new FormData(event.currentTarget);
              const nomBrut = formulaire.get("nom");
              const slugBrut = formulaire.get("slug");
              const nomSaisi = typeof nomBrut === "string" ? nomBrut : nom;
              const slugSaisi = typeof slugBrut === "string" ? slugBrut : slug;
              const colonnes: string[] = [];
              const valeurs: string[] = [];
              if (nomSaisi !== baseNom) {
                colonnes.push("nom = ?");
                valeurs.push(nomSaisi);
              }
              if (slugSaisi !== baseSlug) {
                colonnes.push("slug = ?");
                valeurs.push(slugSaisi);
              }
              if (colonnes.length === 0) return;
              void (async () => {
                const database = await getPowerSyncDatabase();
                const actuels = await database.getAll<{ revision: number | null }>(
                  "SELECT revision FROM cabinets WHERE id = ?",
                  [DEMO_CABINET_ID],
                );
                const revision = actuels[0]?.revision ?? 1;
                await database.execute(
                  "CREATE TABLE IF NOT EXISTS revision_edition (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
                );
                await database.execute(
                  "INSERT INTO revision_edition (id, revision) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision",
                  [DEMO_CABINET_ID, revision],
                );
                await database.execute(`UPDATE cabinets SET ${colonnes.join(", ")} WHERE id = ?`, [
                  ...valeurs,
                  DEMO_CABINET_ID,
                ]);
              })();
              setNom(nomSaisi);
              setSlug(slugSaisi);
              baseNomRef.current = nomSaisi;
              baseSlugRef.current = slugSaisi;
              setBaseNom(nomSaisi);
              setBaseSlug(slugSaisi);
            }}
          >
            <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="cabinet-nom">
              {fr("Nom du cabinet")}
            </label>
            <input
              id="cabinet-nom"
              name="nom"
              className="mt-1 mb-3 w-full max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
              value={nom}
              onChange={(event) => {
                setNom(event.target.value);
              }}
            />
            <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="cabinet-slug">
              {fr("Slug du cabinet")}
            </label>
            <input
              id="cabinet-slug"
              name="slug"
              className="mt-1 mb-3 w-full max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
              }}
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
            >
              {fr("Enregistrer")}
            </button>
          </form>

          <section className="space-y-3">
            <h2 className="text-[length:var(--font-size-section)] font-extrabold text-encre">
              {fr("Référence des dossiers")}
            </h2>
            {horsLigne ? (
              <p
                className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-4 py-3 text-encre"
                role="status"
                data-testid="reglages-reference-hors-ligne"
              >
                {fr("Modification possible en ligne seulement.")}
              </p>
            ) : null}
            <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="reference-modele">
              {fr("Modèle")}
            </label>
            <input
              id="reference-modele"
              data-testid="reglages-reference-modele"
              className="mt-1 mb-3 w-full max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
              value={modeleReference}
              onChange={(event) => {
                setModeleReference(event.target.value);
              }}
            />
            <ConstructeurReference
              blocs={blocsDepuisTexte(modeleReference)}
              onChange={setModeleReference}
            />
            <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="reference-politique">
              {fr("Remise à zéro")}
            </label>
            <select
              id="reference-politique"
              data-testid="reglages-reference-politique"
              className="mt-1 mb-3 w-full max-w-xs rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
              value={remiseAZero}
              onChange={(event) => {
                const valeur = event.target.value;
                if (estRemise(valeur)) setRemiseAZero(valeur);
              }}
            >
              <option value="annuelle">{fr("Chaque année")}</option>
              <option value="jamais">{fr("Jamais")}</option>
            </select>
            <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="reference-numero-depart">
              {fr("Numéro de départ")}
            </label>
            <input
              id="reference-numero-depart"
              data-testid="reglages-reference-numero-depart"
              type="number"
              min={1}
              className="mt-1 mb-3 w-full max-w-xs rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
              value={numeroDepart}
              onChange={(event) => {
                setNumeroDepart(event.target.value);
              }}
            />
            <p
              className="text-[length:var(--font-size-meta)] font-bold text-encre"
              data-testid="reglages-reference-apercu"
            >
              {erreurModele.length > 0 ? fr(erreurModele) : fr(`Aperçu : ${apercuTexte}`)}
            </p>
            <button
              type="button"
              data-testid="reglages-reference-enregistrer"
              className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
              disabled={horsLigne}
              onClick={() => {
                void enregistrerReference();
              }}
            >
              {fr("Enregistrer le modèle")}
            </button>
            {messageReference !== "" ? (
              <p className="text-[length:var(--font-size-dense)] text-encre" role="status">
                {fr(messageReference)}
              </p>
            ) : null}
            {numeroDepartMinimal !== null ? (
              <p
                className="text-[length:var(--font-size-dense)] text-encre"
                data-testid="reglages-reference-numero-minimal"
                role="status"
              >
                {String(numeroDepartMinimal)}
              </p>
            ) : null}
          </section>

          {refusMessage !== null ? (
            <p
              className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-4 py-3 text-encre"
              role="status"
              data-testid="refus-sync"
            >
              {fr(refusMessage)}
            </p>
          ) : null}

          {conflits > 0 ? (
            <p
              className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-4 py-3 text-encre"
              role="status"
              data-testid="conflit-sync"
            >
              {fr(
                `Conflit de synchronisation : ${String(conflits)} champ(s). La dernière écriture a été conservée ; la valeur remplacée est dans le journal.`,
              )}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {onReconnect !== undefined ? (
              <button
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-[length:var(--font-size-dense)] text-graphite"
                data-testid="se-reconnecter"
                onClick={onReconnect}
              >
                {fr("Se reconnecter")}
              </button>
            ) : null}
            {onResetSession !== undefined ? (
              <button
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-[length:var(--font-size-dense)] text-graphite"
                onClick={() => {
                  void clearSession().then(() => {
                    onResetSession();
                  });
                }}
              >
                {fr("Se déconnecter (test)")}
              </button>
            ) : null}
          </div>
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
