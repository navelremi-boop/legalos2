import { useEffect, useState } from "react";
import { FormulaireProfil } from "@/identite/FormulaireProfil";
import { inviterACompleter, libelleMembre } from "@/identite/libelleMembre";
import { enregistrerProfil, listerUtilisateurs } from "@/identite/profilApi";
import { libelleQualite, libelleRole, type ProfilMembre } from "@/identite/profilMembre";
import { fr } from "@/lib/fr";

type PanneauUtilisateursProps = {
  instanceUrl: string;
  horsLigne: boolean;
  /** Galerie : membres figés, aucune lecture ni écriture. */
  demo?: readonly ProfilMembre[];
};

/**
 * Réglages, Utilisateurs : l'identité des membres du cabinet, pour un administrateur. Liste et modification en
 * ligne (`GET /utilisateurs`, `PATCH /utilisateurs/{id}/profil`) ; hors ligne, message et saisie désactivée.
 * La mise en page suit la liste « Collaborateurs et droits » de prototype-reglages.html.
 */
export function PanneauUtilisateurs({ instanceUrl, horsLigne, demo }: PanneauUtilisateursProps) {
  const [membres, setMembres] = useState<ProfilMembre[]>(demo === undefined ? [] : [...demo]);
  const [chargement, setChargement] = useState(demo === undefined);
  const [erreur, setErreur] = useState("");
  const [enEdition, setEnEdition] = useState<string | null>(null);

  useEffect(() => {
    if (demo !== undefined || horsLigne) return;
    let stop = false;
    void listerUtilisateurs(instanceUrl).then((resultat) => {
      if (stop) return;
      setChargement(false);
      if (resultat.ok) {
        setMembres(resultat.profils);
        setErreur("");
      } else {
        setErreur(resultat.message);
      }
    });
    return () => {
      stop = true;
    };
  }, [instanceUrl, horsLigne, demo]);

  const hors = horsLigne && demo === undefined;
  return (
    <div data-testid="reglages-utilisateurs">
      <h2 className="feuille-titre mb-1">{fr("Utilisateurs")}</h2>
      <p className="mb-5 max-w-[var(--lecture-max)] text-[length:var(--font-size-dense)] text-graphite">
        {fr(
          "L'identité des membres du cabinet signe les notes et désigne l'avocat d'un dossier. Elle se saisit ici et dans « Mon profil ».",
        )}
      </p>
      {hors ? (
        <p className="message-info" role="status" data-testid="utilisateurs-hors-ligne">
          {fr("Hors ligne : les utilisateurs se modifient en ligne seulement.")}
        </p>
      ) : null}
      {erreur !== "" ? (
        <p className="message-erreur" role="alert" data-testid="utilisateurs-erreur">
          {fr(erreur)}
        </p>
      ) : null}
      {!hors && chargement ? <p className="etat-vide">{fr("Chargement des utilisateurs.")}</p> : null}
      {membres.length > 0 ? (
        <ul className="utilisateurs-liste" data-testid="utilisateurs-liste">
          <li className="utilisateurs-ligne utilisateurs-ligne--tete" aria-hidden="true">
            <span>{fr("Nom")}</span>
            <span>{fr("Qualité")}</span>
            <span>{fr("Rôle")}</span>
            <span />
          </li>
          {membres.map((membre) => (
            <li key={membre.id} data-testid="utilisateur" data-utilisateur-id={membre.id}>
              <div className="utilisateurs-ligne">
                <span className="utilisateurs-ligne__nom">
                  <b data-testid="utilisateur-libelle">{fr(libelleMembre(membre))}</b>
                  <small>
                    {inviterACompleter(membre) ? fr("Identité à compléter") : fr(membre.email)}
                    {membre.actif ? "" : fr(" — Désactivé")}
                  </small>
                </span>
                <span>{fr(libelleQualite(membre.qualite))}</span>
                <span>{fr(libelleRole(membre.role))}</span>
                <span className="utilisateurs-ligne__action">
                  {!hors ? (
                    <button
                      type="button"
                      className="bouton bouton--petit"
                      data-testid="utilisateur-modifier"
                      aria-expanded={enEdition === membre.id}
                      onClick={() => {
                        setEnEdition(enEdition === membre.id ? null : membre.id);
                      }}
                    >
                      {fr("Modifier")}
                    </button>
                  ) : null}
                </span>
              </div>
              {enEdition === membre.id ? (
                <div className="utilisateurs-edition" data-testid="utilisateur-edition">
                  <FormulaireProfil
                    key={membre.id}
                    profil={membre}
                    horsLigne={hors}
                    prefixe="utilisateur"
                    onEnregistrer={(saisie) =>
                      demo === undefined
                        ? enregistrerProfil(instanceUrl, membre, saisie, false)
                        : Promise.resolve({ ok: true as const, profil: membre })
                    }
                    onEnregistre={(profil) => {
                      setMembres((etat) => etat.map((courant) => (courant.id === profil.id ? profil : courant)));
                    }}
                    onAnnuler={() => {
                      setEnEdition(null);
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!hors && !chargement && erreur === "" && membres.length === 0 ? (
        <p className="etat-vide">{fr("Aucun utilisateur.")}</p>
      ) : null}
    </div>
  );
}
