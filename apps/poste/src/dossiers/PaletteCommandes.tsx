import { useEffect, useState } from "react";
import { echapperMotifLike } from "@/lib/echapperMotifLike";
import { fr } from "@/lib/fr";
import { libelleReferenceDossier } from "@/lib/referenceDossier";
import { getPowerSyncDatabase } from "@/sync/database";

type Resultat = {
  id: string;
  nom: string;
  numero_rg: string;
  juridiction: string;
  reference: string | null;
};

export function PaletteCommandes() {
  const [ouverte, setOuverte] = useState(false);
  const [requete, setRequete] = useState("");
  const [resultats, setResultats] = useState<Resultat[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOuverte(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!ouverte) return;
    const terme = `%${echapperMotifLike(requete.trim())}%`;
    void getPowerSyncDatabase()
      .then((database) =>
        database.getAll<Resultat>(
          `SELECT DISTINCT d.id, d.nom, d.numero_rg, d.juridiction, d.reference
           FROM dossiers d
           LEFT JOIN parties p ON p.dossier_id = d.id
           WHERE d.nom LIKE ? ESCAPE '\\' OR d.numero_rg LIKE ? ESCAPE '\\'
              OR d.juridiction LIKE ? ESCAPE '\\' OR p.nom LIKE ? ESCAPE '\\'
              OR IFNULL(d.reference, '') LIKE ? ESCAPE '\\'
           LIMIT 8`,
          [terme, terme, terme, terme, terme],
        ),
      )
      .then(setResultats)
      .catch(() => {
        setResultats([]);
      });
  }, [ouverte, requete]);

  if (!ouverte) {
    return (
      <button
        type="button"
        id="ouvrir-palette"
        className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        onClick={() => {
          setOuverte(true);
        }}
      >
        {fr("Rechercher un dossier")}
      </button>
    );
  }

  return (
    <div className="mb-6 rounded-[var(--radius-overlay)] border border-filet bg-feuille p-4 shadow-[var(--shadow-floating)]">
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="palette-recherche">
        {fr("Aller à un dossier")}
      </label>
      <input
        id="palette-recherche"
        className="mt-1 mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
        value={requete}
        onChange={(event) => {
          setRequete(event.target.value);
        }}
      />
      <ul>
        {resultats.map((ligne) => {
          const reference = libelleReferenceDossier(ligne.reference);
          return (
            <li
              key={ligne.id}
              data-testid="palette-resultat"
              data-dossier-id={ligne.id}
              data-reference={reference}
            >
              {fr(`${reference} — ${ligne.nom} — ${ligne.numero_rg} — ${ligne.juridiction}`)}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="mt-3 text-[length:var(--font-size-dense)] text-graphite"
        onClick={() => {
          setOuverte(false);
        }}
      >
        {fr("Fermer")}
      </button>
    </div>
  );
}
