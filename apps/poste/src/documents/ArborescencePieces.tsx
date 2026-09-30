import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  documentADivergence,
  ouvrirDocument,
} from "@/documents/ouvrirDocument";
import { rechercherDocuments, type ResultatRechercheDocument } from "@/documents/rechercheDocuments";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

type RepertoireLocal = {
  id: string;
  parent_id: string | null;
  nom: string;
};

type DocumentLocal = {
  id: string;
  nom: string;
  repertoire_id: string | null;
};

type ArborescencePiecesProps = {
  dossierId: string;
};

export function ArborescencePieces({ dossierId }: ArborescencePiecesProps) {
  const [repertoires, setRepertoires] = useState<RepertoireLocal[]>([]);
  const [documents, setDocuments] = useState<DocumentLocal[]>([]);
  const [divergences, setDivergences] = useState<Set<string>>(new Set());
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<ResultatRechercheDocument[]>([]);
  const [rechercheActive, setRechercheActive] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const etat = { stop: false };
    const arrete = () => etat.stop;
    const charger = () => {
      void getPowerSyncDatabase()
        .then(async (database) => {
          const reps = await database.getAll<RepertoireLocal>(
            `SELECT id, parent_id, nom FROM repertoires
             WHERE dossier_id = ? ORDER BY nom COLLATE NOCASE`,
            [dossierId],
          );
          const docs = await database.getAll<DocumentLocal>(
            `SELECT id, nom, repertoire_id FROM documents
             WHERE dossier_id = ? ORDER BY nom COLLATE NOCASE`,
            [dossierId],
          );
          if (arrete()) return;
          setRepertoires(
            reps.map((r) => ({
              ...r,
              parent_id: r.parent_id && r.parent_id.length > 0 ? r.parent_id : null,
            })),
          );
          setDocuments(
            docs.map((d) => ({
              ...d,
              repertoire_id:
                d.repertoire_id && d.repertoire_id.length > 0 ? d.repertoire_id : null,
            })),
          );
          const divergents = new Set<string>();
          await Promise.all(
            docs.map(async (doc) => {
              if (await documentADivergence(doc.id)) {
                divergents.add(doc.id);
              }
            }),
          );
          if (arrete()) return;
          setDivergences(divergents);
        })
        .catch(() => {
          if (!arrete()) {
            setRepertoires([]);
            setDocuments([]);
          }
        });
    };
    charger();
    const timer = window.setInterval(charger, 1_500);
    return () => {
      etat.stop = true;
      window.clearInterval(timer);
    };
  }, [dossierId]);

  useEffect(() => {
    const terme = recherche.trim();
    if (terme === "") {
      return;
    }
    const handle = window.setTimeout(() => {
      void rechercherDocuments(dossierId, terme).then((rows) => {
        setResultats(rows);
        setRechercheActive(true);
      });
    }, 200);
    return () => {
      window.clearTimeout(handle);
    };
  }, [dossierId, recherche]);

  const enfantsParParent = useMemo(() => {
    const map = new Map<string | null, RepertoireLocal[]>();
    for (const rep of repertoires) {
      const cle = rep.parent_id;
      const liste = map.get(cle) ?? [];
      liste.push(rep);
      map.set(cle, liste);
    }
    return map;
  }, [repertoires]);

  const docsParRep = useMemo(() => {
    const map = new Map<string | null, DocumentLocal[]>();
    for (const doc of documents) {
      const cle = doc.repertoire_id;
      const liste = map.get(cle) ?? [];
      liste.push(doc);
      map.set(cle, liste);
    }
    return map;
  }, [documents]);

  async function ouvrir(id: string) {
    setMessage("");
    try {
      await ouvrirDocument(id);
      setMessage(fr("Document ouvert dans l'éditeur du système."));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : fr("Ouverture impossible."));
    }
  }

  function renduDocs(repertoireId: string | null) {
    const docs = docsParRep.get(repertoireId) ?? [];
    return docs.map((doc) => (
      <li
        key={doc.id}
        className="flex flex-wrap items-center gap-2 py-1"
        data-testid="document"
        data-document-id={doc.id}
      >
        <span className="text-encre">{fr(doc.nom)}</span>
        {divergences.has(doc.id) ? (
          <span
            className="rounded-[var(--radius-control)] bg-echeance-fond px-2 py-0.5 text-[length:var(--font-size-dense)] text-echeance"
            data-testid="document-divergence"
            role="status"
          >
            {fr("Versions divergentes")}
          </span>
        ) : null}
        <button
          type="button"
          className="rounded-[var(--radius-control)] border border-filet bg-page px-2 py-1 text-[length:var(--font-size-dense)] text-encre"
          data-testid="ouvrir-document"
          data-document-id={doc.id}
          onClick={() => {
            void ouvrir(doc.id);
          }}
        >
          {fr("Ouvrir")}
        </button>
      </li>
    ));
  }

  function renduRep(parentId: string | null, profondeur: number): ReactNode {
    const enfants = enfantsParParent.get(parentId) ?? [];
    const marge =
      profondeur === 0 ? undefined : ({ paddingLeft: `${String(profondeur * 12)}px` } as const);
    return enfants.map((rep) => (
      <li
        key={rep.id}
        className="mt-2"
        data-testid="repertoire"
        data-repertoire-id={rep.id}
        style={marge}
      >
        <p className="font-bold text-encre">{fr(rep.nom)}</p>
        <ul className="ml-3 list-none">{renduDocs(rep.id)}</ul>
        <ul className="list-none">{renduRep(rep.id, profondeur + 1)}</ul>
      </li>
    ));
  }

  const afficherRecherche = rechercheActive && recherche.trim() !== "";

  return (
    <div className="p-[22px] pb-24" data-testid="arborescence">
      <h3 className="mb-3 text-[length:var(--font-size-section)] font-extrabold">{fr("Pièces")}</h3>
      <label className="mb-1 block text-[length:var(--font-size-dense)] text-graphite" htmlFor="recherche-documents">
        {fr("Rechercher dans les noms et le contenu")}
      </label>
      <input
        id="recherche-documents"
        data-testid="recherche-documents"
        className="mb-4 w-full max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-encre"
        value={recherche}
        onChange={(event) => {
          const valeur = event.target.value;
          setRecherche(valeur);
          if (valeur.trim() === "") {
            setRechercheActive(false);
            setResultats([]);
          }
        }}
        placeholder={fr("Nom ou texte…")}
      />
      {afficherRecherche ? (
        <ul className="mb-4 space-y-1" data-testid="resultat-recherche">
          {resultats.length === 0 ? (
            <li className="text-graphite">{fr("Aucun résultat.")}</li>
          ) : (
            resultats.map((r) => (
              <li key={r.document_id} data-document-id={r.document_id}>
                <button
                  type="button"
                  className="text-left text-encre underline"
                  data-testid="ouvrir-document"
                  data-document-id={r.document_id}
                  onClick={() => {
                    void ouvrir(r.document_id);
                  }}
                >
                  {fr(r.nom)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      <ul className="list-none">
        {renduRep(null, 0)}
        <li className="mt-2">
          <ul className="list-none">{renduDocs(null)}</ul>
        </li>
      </ul>
      {documents.length === 0 && repertoires.length === 0 ? (
        <p className="mt-4 text-graphite">{fr("Aucun document dans ce dossier.")}</p>
      ) : null}
      {message ? (
        <p className="mt-3 text-[length:var(--font-size-dense)] text-graphite" role="status">
          {fr(message)}
        </p>
      ) : null}
    </div>
  );
}
