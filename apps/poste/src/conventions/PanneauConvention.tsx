import { useEffect, useState } from "react";
import { produireDocument } from "@/modeles/produireDocument";
import {
  alerteDuDossier,
  creerConvention,
  deposerSigne,
  leverAlerte,
  lireConventions,
  marquerEnvoyee,
  MODES_CONVENTION,
  type ConventionDossier,
  type ModeConvention,
} from "@/conventions/stockConvention";
import { MOTIFS_LEVEE, type MotifLevee } from "@/conventions/alerteConvention";
import { fr } from "@/lib/fr";
import { jourCivil } from "@/agenda/navigationAgenda";

const LIBELLE_MODE: Record<ModeConvention, string> = {
  temps: "Temps passé",
  forfait: "Forfait",
  resultat: "Résultat complémentaire",
};

const LIBELLE_MOTIF: Record<MotifLevee, string> = {
  urgence: "Urgence et force majeure",
  hors_application: "Convention signée hors de l'application",
  aide_juridictionnelle: "Aide juridictionnelle totale",
  premier_rendez_vous: "Premier rendez-vous sans honoraires",
  dossier_interne: "Dossier interne du cabinet",
};

export function PanneauConvention({ dossierId }: { dossierId: string }) {
  const [conventions, setConventions] = useState<ConventionDossier[]>([]);
  const [mode, setMode] = useState<ModeConvention>("temps");
  const [motif, setMotif] = useState<MotifLevee>("urgence");
  const [dateHors, setDateHors] = useState("");
  const [message, setMessage] = useState("");
  const aujourdhui = jourCivil(new Date());
  const alerte = alerteDuDossier(conventions, aujourdhui);

  async function recharger(): Promise<void> {
    setConventions(await lireConventions(dossierId));
  }

  useEffect(() => {
    let stop = false;
    void lireConventions(dossierId).then((lignes) => {
      if (!stop) setConventions(lignes);
    });
    return () => {
      stop = true;
    };
  }, [dossierId]);

  return (
    <section className="mt-4 max-w-md space-y-2 text-encre" data-testid="panneau-convention">
      {alerte ? (
        <p className="rounded-[var(--radius-control)] bg-feuille px-3 py-2" data-testid="alerte-convention" role="status">
          {fr("Aucune convention d'honoraires signée.")}
        </p>
      ) : null}
      <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="convention-mode">
        {fr("Mode d'honoraires")}
        <select
          id="convention-mode"
          data-testid="convention-mode"
          className="mt-1 block w-full rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2"
          value={mode}
          onChange={(event) => {
            const valeur = event.target.value;
            if (valeur === "temps" || valeur === "forfait" || valeur === "resultat") setMode(valeur);
          }}
        >
          {MODES_CONVENTION.map((entree) => (
            <option key={entree} value={entree}>
              {fr(LIBELLE_MODE[entree])}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-testid="convention-produire"
        className="rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2"
        onClick={() => {
          void produireDocument(dossierId, "convention")
            .then((produit) => creerConvention(dossierId, mode, produit.documentId))
            .then(() => {
              return recharger();
            })
            .then(() => {
              setMessage(fr("Convention produite."));
            })
            .catch(() => {
              setMessage(fr("La convention n'a pas pu être produite."));
            });
        }}
      >
        {fr("Produire la convention")}
      </button>
      <ul data-testid="convention-liste">
        {conventions
          .filter((convention) => convention.documentId)
          .map((convention) => (
            <li key={convention.id} data-testid="convention-ligne" data-statut={convention.statut} data-mode={convention.mode}>
              <span>{fr(`${LIBELLE_MODE[convention.mode]}, ${convention.statut}`)}</span>
              {convention.statut === "brouillon" ? (
                <button
                  type="button"
                  data-testid="convention-envoyer"
                  className="ml-2"
                  onClick={() => {
                    void marquerEnvoyee(convention.id).then(() => {
                      return recharger();
                    });
                  }}
                >
                  {fr("Marquer envoyée")}
                </button>
              ) : null}
              {convention.statut === "envoyee" ? (
                <label className="ml-2" htmlFor={`convention-signe-${convention.id}`}>
                  {fr("Exemplaire signé")}
                  <input
                    id={`convention-signe-${convention.id}`}
                    data-testid="convention-signe"
                    type="file"
                    onChange={(event) => {
                      const fichier = event.target.files?.[0];
                      if (!fichier) return;
                      void deposerSigne(convention.id, fichier.name).then(() => {
                        return recharger();
                      });
                    }}
                  />
                </label>
              ) : null}
              {convention.signeNom ? <span data-testid="convention-signe-nom">{fr(convention.signeNom)}</span> : null}
            </li>
          ))}
      </ul>
      {alerte ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void leverAlerte(dossierId, motif, aujourdhui, motif === "hors_application" ? dateHors : null).then(() => {
              return recharger();
            });
          }}
        >
          <label className="block text-[length:var(--font-size-dense)] text-graphite" htmlFor="convention-motif">
            {fr("Lever l'alerte")}
            <select
              id="convention-motif"
              data-testid="convention-motif"
              className="mt-1 block w-full rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2"
              value={motif}
              onChange={(event) => {
                const valeur = event.target.value;
                if (
                  valeur === "urgence" ||
                  valeur === "hors_application" ||
                  valeur === "aide_juridictionnelle" ||
                  valeur === "premier_rendez_vous" ||
                  valeur === "dossier_interne"
                ) {
                  setMotif(valeur);
                }
              }}
            >
              {MOTIFS_LEVEE.map((entree) => (
                <option key={entree} value={entree}>
                  {fr(LIBELLE_MOTIF[entree])}
                </option>
              ))}
            </select>
          </label>
          {motif === "hors_application" ? (
            <label className="mt-2 block text-[length:var(--font-size-dense)] text-graphite" htmlFor="convention-date-hors">
              {fr("Date de la convention")}
              <input
                id="convention-date-hors"
                data-testid="convention-date-hors"
                type="date"
                required
                className="mt-1 block"
                value={dateHors}
                onChange={(event) => {
                  setDateHors(event.target.value);
                }}
              />
            </label>
          ) : null}
          <button type="submit" data-testid="convention-lever" className="mt-2">
            {fr("Consigner la levée")}
          </button>
        </form>
      ) : null}
      <p data-testid="convention-message" role="status">
        {message}
      </p>
    </section>
  );
}
