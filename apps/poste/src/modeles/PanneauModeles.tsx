import { useEffect, useState } from "react";
import { DepotDiffere, envoyerModele, lireModeleDistant } from "@/modeles/depotCabinet";
import { FusionIncomplete, GENRES_MODELE, type GenreModele } from "@/modeles/fusionDocx";
import { produireDocument, reprendreDepots } from "@/modeles/produireDocument";
import { enregistrerModele, lireModele, modeleRemplace } from "@/modeles/stockModeles";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

const LIBELLES: Record<GenreModele, string> = {
  courrier: "Courrier",
  convention: "Convention",
  acte: "Acte",
};

type DossierChoix = { id: string; nom: string };

async function cabinetLocal(): Promise<string> {
  const database = await getPowerSyncDatabase();
  const lignes = await database.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1");
  return lignes[0]?.id ?? "";
}

export function PanneauModeles() {
  const [dossiers, setDossiers] = useState<DossierChoix[]>([]);
  const [dossierId, setDossierId] = useState("");
  const [cabinetId, setCabinetId] = useState("");
  const [genre, setGenre] = useState<GenreModele>("courrier");
  const [remplace, setRemplace] = useState(false);
  const [message, setMessage] = useState("");
  const [resultat, setResultat] = useState<{
    id: string;
    nom: string;
    styles: boolean;
    residuelles: number;
    enAttente: boolean;
  } | null>(null);

  useEffect(() => {
    let stop = false;
    void getPowerSyncDatabase()
      .then(async (database) => {
        const [lignes, cabinets] = await Promise.all([
          database.getAll<DossierChoix>("SELECT id, nom FROM dossiers ORDER BY nom"),
          database.getAll<{ id: string }>("SELECT id FROM cabinets LIMIT 1"),
        ]);
        return { lignes, cabinet: cabinets[0]?.id ?? "" };
      })
      .then(({ lignes, cabinet }) => {
        if (stop) return;
        setDossiers(lignes);
        setDossierId((actuel) => actuel || lignes[0]?.id || "");
        setCabinetId(cabinet);
        setRemplace(modeleRemplace(localStorage, cabinet, "courrier"));
      })
      .catch(() => {
        if (!stop) setDossiers([]);
      });
    return () => {
      stop = true;
    };
  }, []);

  async function appliquerGenre(valeur: GenreModele, cabinet: string): Promise<void> {
    setGenre(valeur);
    setRemplace(modeleRemplace(localStorage, cabinet, valeur));
    try {
      const distant = await lireModeleDistant(valeur);
      if (distant && cabinet !== "") {
        enregistrerModele(localStorage, cabinet, valeur, distant);
        setRemplace(true);
      }
    } catch (erreur) {
      if (!(erreur instanceof DepotDiffere)) setMessage(fr("La lecture du modèle a échoué."));
    }
  }

  return (
    <section id="reglages-modeles" className="space-y-3" data-testid="reglages-modeles">
      <h2 className="text-[length:var(--font-size-section)] font-extrabold text-encre">
        {fr("Modèles de documents")}
      </h2>
      <p className="text-graphite">
        {fr("Le modèle du cabinet remplace celui qui est livré. La génération se fait sur ce poste.")}
      </p>
      <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="fusion-genre">
        {fr("Genre")}
        <select
          id="fusion-genre"
          data-testid="fusion-genre"
          className="mt-1 block w-full max-w-xs rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
          value={genre}
          onChange={(event) => {
            const valeur = event.target.value;
            if (valeur === "courrier" || valeur === "convention" || valeur === "acte") {
              void appliquerGenre(valeur, cabinetId);
            }
          }}
        >
          {GENRES_MODELE.map((entree) => (
            <option key={entree} value={entree}>
              {fr(LIBELLES[entree])}
            </option>
          ))}
        </select>
      </label>
      <p data-testid="fusion-origine">{fr(remplace ? "Modèle du cabinet" : "Modèle livré")}</p>
      <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="fusion-fichier">
        {fr("Remplacer le modèle")}
        <input
          id="fusion-fichier"
          data-testid="fusion-fichier"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="mt-1 block text-encre"
          onChange={(event) => {
            const fichier = event.target.files?.[0];
            if (!fichier) return;
            void fichier.arrayBuffer().then(async (tampon) => {
              const octets = new Uint8Array(tampon);
              const cabinet = cabinetId || (await cabinetLocal());
              try {
                await envoyerModele(genre, octets);
                enregistrerModele(localStorage, cabinet, genre, octets);
                setCabinetId(cabinet);
                setRemplace(true);
                setMessage(fr("Modèle enregistré."));
              } catch (erreur) {
                if (erreur instanceof DepotDiffere) {
                  setMessage(fr("Le modèle n'a pas pu être enregistré pour le cabinet."));
                  return;
                }
                setMessage(fr("Le modèle n'a pas été accepté."));
              }
            });
          }}
        />
      </label>
      <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="fusion-dossier">
        {fr("Dossier")}
        <select
          id="fusion-dossier"
          data-testid="fusion-dossier"
          className="mt-1 block w-full max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
          value={dossierId}
          onChange={(event) => {
            setDossierId(event.target.value);
          }}
        >
          {dossiers.map((ligne) => (
            <option key={ligne.id} value={ligne.id}>
              {fr(ligne.nom)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-testid="fusion-produire"
        className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
        onClick={() => {
          setMessage("");
          setResultat(null);
          void produireDocument(dossierId, genre)
            .then((produit) => {
              setResultat({
                id: produit.documentId,
                nom: produit.nom,
                styles: produit.stylesIdentiques,
                residuelles: produit.balisesResiduelles,
                enAttente: produit.enAttente,
              });
              setMessage(
                fr(
                  produit.enAttente
                    ? "Le document est prêt sur ce poste. Il sera versé au dossier au retour du réseau."
                    : `${produit.nom} est une version du dossier.`,
                ),
              );
            })
            .catch((erreur: unknown) => {
              if (erreur instanceof FusionIncomplete) {
                setMessage(fr(`Champs manquants : ${erreur.champsManquants.join(", ")}`));
                return;
              }
              setMessage(fr("La génération a échoué."));
            });
        }}
      >
        {fr("Produire")}
      </button>
      <button
        type="button"
        data-testid="fusion-reprendre"
        className="rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-3 py-2 text-encre"
        onClick={() => {
          void reprendreDepots().then((nombre) => {
            setMessage(
              fr(
                nombre > 0
                  ? "Les documents en attente sont versés au dossier."
                  : "Aucun document en attente n'a pu être versé.",
              ),
            );
          });
        }}
      >
        {fr("Reprendre les versements")}
      </button>
      <p data-testid="fusion-message" role="status">
        {message}
      </p>
      {resultat ? (
        <p
          data-testid="fusion-resultat"
          data-styles={resultat.styles ? "identiques" : "modifies"}
          data-balises={String(resultat.residuelles)}
          data-attente={resultat.enAttente ? "oui" : "non"}
          data-document-id={resultat.id}
          data-document-nom={resultat.nom}
        >
          {fr(resultat.nom)}
        </p>
      ) : null}
      <p className="sr-only" data-testid="fusion-modele-octets">
        {String(cabinetId === "" ? 0 : lireModele(localStorage, cabinetId, genre).byteLength)}
      </p>
    </section>
  );
}
