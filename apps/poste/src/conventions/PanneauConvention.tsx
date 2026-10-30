import { useEffect, useState } from "react";
import { Annonce } from "@/coque/Annonce";
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
  type StatutConvention,
} from "@/conventions/stockConvention";
import { MOTIFS_LEVEE, type MotifLevee } from "@/conventions/alerteConvention";
import { fr } from "@/lib/fr";
import { jourCivil } from "@/agenda/navigationAgenda";
import { PanneauLateral } from "@/coque/PanneauLateral";

const LIBELLE_MODE: Record<ModeConvention, string> = {
  temps: "Temps passé",
  forfait: "Forfait",
  resultat: "Résultat complémentaire",
};

const LIBELLE_STATUT: Record<StatutConvention, string> = {
  brouillon: "Brouillon, à envoyer",
  envoyee: "Envoyée, en attente de signature",
  signee: "Signée",
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
  const [ouvert, setOuvert] = useState(false);
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
    <section className="contents" data-testid="panneau-convention">
      {alerte ? (
        <p className="alerte-chemise" data-testid="alerte-convention" role="status">
          {fr("Aucune convention d'honoraires signée.")}
        </p>
      ) : null}
      <button
        type="button"
        className="bouton-chemise"
        data-testid="convention-ouvrir"
        aria-expanded={ouvert}
        onClick={() => {
          setOuvert(true);
        }}
      >
        {fr("Convention d'honoraires")}
      </button>
      <PanneauLateral
        ouvert={ouvert}
        titre="Convention d'honoraires"
        sousTitre="Produire la convention, la marquer envoyée, déposer l'exemplaire signé."
        onFermer={() => {
          setOuvert(false);
        }}
      >
        <div className="panneau-lateral__section">
          <label className="etiquette-champ" htmlFor="convention-mode">
            {fr("Mode d'honoraires")}
          </label>
          <select
            id="convention-mode"
            data-testid="convention-mode"
            className="champ"
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
          <div className="formulaire-actions">
            <button
              type="button"
              data-testid="convention-produire"
              className="bouton bouton--prim"
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
          </div>
          <ul className="convention-liste" data-testid="convention-liste">
            {conventions
              .filter((convention) => convention.documentId)
              .map((convention) => (
                <li
                  key={convention.id}
                  className="convention-liste__ligne"
                  data-testid="convention-ligne"
                  data-statut={convention.statut}
                  data-mode={convention.mode}
                >
                  <span>
                    <b>{fr(LIBELLE_MODE[convention.mode])}</b>
                    <span className="block text-[length:var(--font-size-meta)] text-graphite">
                      {fr(LIBELLE_STATUT[convention.statut])}
                    </span>
                  </span>
                  {convention.statut === "brouillon" ? (
                    <button
                      type="button"
                      data-testid="convention-envoyer"
                      className="bouton bouton--petit"
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
                    <label className="convention-liste__fichier" htmlFor={`convention-signe-${convention.id}`}>
                      {fr("Déposer l'exemplaire signé")}
                      <input
                        id={`convention-signe-${convention.id}`}
                        data-testid="convention-signe"
                        type="file"
                        className="sr-only"
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
                  {convention.signeNom ? (
                    <span className="truncate text-[length:var(--font-size-dense)]" data-testid="convention-signe-nom">
                      {fr(convention.signeNom)}
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
        {alerte ? (
          <form
            className="panneau-lateral__section"
            onSubmit={(event) => {
              event.preventDefault();
              void leverAlerte(dossierId, motif, aujourdhui, motif === "hors_application" ? dateHors : null).then(() => {
                return recharger();
              });
            }}
          >
            <h3 className="feuille-titre mb-1">{fr("Lever l'alerte")}</h3>
            <p className="mb-3 text-[length:var(--font-size-dense)] text-graphite">
              {fr("Sans convention signée, indiquez ce qui dispense de l'alerte.")}
            </p>
            <label className="etiquette-champ" htmlFor="convention-motif">
              {fr("Motif")}
            </label>
            <select
              id="convention-motif"
              data-testid="convention-motif"
              className="champ"
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
            {motif === "hors_application" ? (
              <div className="mt-3">
                <label className="etiquette-champ" htmlFor="convention-date-hors">
                  {fr("Date de la convention")}
                </label>
                <input
                  id="convention-date-hors"
                  data-testid="convention-date-hors"
                  type="date"
                  required
                  className="champ champ--court"
                  value={dateHors}
                  onChange={(event) => {
                    setDateHors(event.target.value);
                  }}
                />
              </div>
            ) : null}
            <div className="formulaire-actions">
              <button type="submit" data-testid="convention-lever" className="bouton">
                {fr("Consigner la levée")}
              </button>
            </div>
          </form>
        ) : null}
        <Annonce texte={message} succes={message === fr("Convention produite.")} testId="convention-message" />
      </PanneauLateral>
    </section>
  );
}
