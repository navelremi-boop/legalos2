import { useEffect, useRef, useState } from "react";
import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";
import { clearSession } from "@/lib/session/storage";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { getPowerSyncDatabase } from "@/sync/database";

export type ThemeMode = "light" | "dark" | "system";

type ReglagesProps = {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onResetSession?: () => void;
  onReconnect?: () => void;
};

export function Reglages({
  themeMode,
  onThemeChange,
  onResetSession,
  onReconnect,
}: ReglagesProps) {
  const [nom, setNom] = useState("");
  const [slug, setSlug] = useState("");
  const [baseNom, setBaseNom] = useState("");
  const [baseSlug, setBaseSlug] = useState("");
  const [conflits, setConflits] = useState(0);
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
          ]),
        )
        .then(([conflitRows, cabinetRows]) => {
          if (stop) return;
          setConflits(conflitRows[0]?.n ?? 0);
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
          if (!stop) setConflits(0);
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
        database.getAll<{ nom: string; slug: string }>(
          "SELECT nom, slug FROM cabinets WHERE id = ? LIMIT 1",
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
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  return (
    <div className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]" data-testid="ecran-reglages">
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
    </div>
  );
}
