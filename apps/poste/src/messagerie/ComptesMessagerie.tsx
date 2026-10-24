import { useCallback, useEffect, useRef, useState } from "react";
import { fr } from "@/lib/fr";
import { ajouterBoite, reconnecterBoite } from "@/messagerie/apiConnexionBoites";
import { lancerConnexionOAuth, lireFournisseursOAuth } from "@/messagerie/apiOAuthBoites";
import { lireSanteMessagerie } from "@/messagerie/apiSanteMessagerie";
import { ChoixConnexionBoite } from "@/messagerie/ChoixConnexionBoite";
import { FormulaireConnexionBoite } from "@/messagerie/FormulaireConnexionBoite";
import { libelleTypeCompte } from "@/messagerie/formesApiRedaction";
import { verificationTerminee, type ChampsConnexion, type ModeConnexion } from "@/messagerie/formesConnexionBoite";
import { libelleEtape, libelleFournisseur, type EtapeOAuth, type FournisseurOAuth } from "@/messagerie/formesOAuth";
import { presenterIndexation, presenterSante, type SanteMessagerie } from "@/messagerie/formesSanteMessagerie";

/**
 * Réglages, Messagerie, « Comptes » (maquette prototype-reglages) : chaque boîte avec son état de connexion, sa dernière
 * relève et ses envois en échec ; ajout d'une boîte et reconnexion d'une boîte dont les identifiants sont refusés.
 * L'état vient du serveur (`GET /messagerie/sante`) et se rafraîchit tout seul ; le poste ne tient aucun identifiant de
 * messagerie : ceux du formulaire partent au serveur et disparaissent avec lui. Une boîte Microsoft 365 ou Gmail se
 * connecte par le navigateur du système (OAuth) : aucun mot de passe, aucun jeton sur le poste.
 */

const RAFRAICHISSEMENT_MS = 30_000;
/** Pendant la vérification d'une connexion : le moteur essaie dans les secondes qui suivent. */
const RAFRAICHISSEMENT_RAPIDE_MS = 3_000;

type FormulaireOuvert = { mode: ModeConnexion; compteId: string; adresse: string };

/** Choix du mode de connexion d'une nouvelle boîte ; `fournisseurs` est `null` tant que la liste se charge. */
type ChoixOuvert = { compteId: string; fournisseurs: FournisseurOAuth[] | null };

/** Connexion OAuth en cours (étape) ou terminée en échec (`erreur`). */
type OauthEnCours = {
  compteId: string;
  adresse: string;
  fournisseur: string;
  etape: EtapeOAuth;
  erreur: string | null;
};

type ComptesMessagerieProps = {
  instanceUrl: string;
  enLigne: boolean;
  /** Galerie : données fictives, aucun appel. */
  demonstration?: SanteMessagerie;
};

export function ComptesMessagerie({ instanceUrl, enLigne, demonstration }: ComptesMessagerieProps) {
  const [sante, setSante] = useState<SanteMessagerie | null>(demonstration ?? null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState<FormulaireOuvert | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  /** Boîtes dont la connexion vient d'être saisie : suivies de près jusqu'à la réponse du moteur. */
  const [enVerification, setEnVerification] = useState<readonly string[]>([]);
  const [rechargement, setRechargement] = useState(0);
  const [choix, setChoix] = useState<ChoixOuvert | null>(null);
  const [oauth, setOauth] = useState<OauthEnCours | null>(null);
  const annulerOauth = useRef<(() => void) | null>(null);

  // Quitter l'écran pendant la connexion l'annule : l'écoute locale se ferme.
  useEffect(
    () => () => {
      annulerOauth.current?.();
    },
    [],
  );

  const aSurveiller =
    sante === null
      ? enVerification.length > 0
      : enVerification.some((id) => {
          const compte = sante.comptes.find((candidat) => candidat.compteId === id);
          return compte === undefined || !verificationTerminee(compte.etatConnexion);
        });

  useEffect(() => {
    if (demonstration !== undefined || !enLigne) return;
    let annule = false;
    const charger = () => {
      void lireSanteMessagerie(instanceUrl).then((resultat) => {
        if (annule) return;
        if (resultat.ok) {
          setSante(resultat.valeur);
          setErreur(null);
        } else {
          setErreur(resultat.statut === 0 ? "L'instance est injoignable." : resultat.message);
        }
      });
    };
    charger();
    const minuterie = window.setInterval(charger, aSurveiller ? RAFRAICHISSEMENT_RAPIDE_MS : RAFRAICHISSEMENT_MS);
    return () => {
      annule = true;
      window.clearInterval(minuterie);
    };
  }, [demonstration, enLigne, instanceUrl, aSurveiller, rechargement]);

  const envoyer = useCallback(
    (champs: ChampsConnexion) => {
      if (formulaire === null || demonstration !== undefined) return;
      setEnvoiEnCours(true);
      setErreurFormulaire(null);
      const appel =
        formulaire.mode === "ajout"
          ? ajouterBoite(instanceUrl, formulaire.compteId, champs)
          : reconnecterBoite(instanceUrl, formulaire.compteId, champs);
      void appel.then((resultat) => {
        setEnvoiEnCours(false);
        if (resultat.ok) {
          setEnVerification((actuel) => [...actuel, formulaire.compteId]);
          setFormulaire(null);
          setRechargement((n) => n + 1);
        } else {
          setErreurFormulaire(resultat.statut === 0 ? "L'instance est injoignable." : resultat.message);
        }
      });
    },
    [demonstration, formulaire, instanceUrl],
  );

  const ouvrir = (mode: ModeConnexion, compteId: string, adresse: string) => {
    setErreurFormulaire(null);
    setFormulaire({ mode, compteId, adresse });
  };

  const ouvrirChoix = () => {
    const compteId = crypto.randomUUID();
    setChoix({ compteId, fournisseurs: null });
    void lireFournisseursOAuth(instanceUrl).then((resultat) => {
      // Une instance sans connexion par fournisseur (ou qui ne répond pas) ne propose que le mot de passe.
      setChoix((actuel) =>
        actuel !== null && actuel.compteId === compteId
          ? { compteId, fournisseurs: resultat.ok ? resultat.valeur : [] }
          : actuel,
      );
    });
  };

  const connecterParFournisseur = (compteId: string, adresse: string, fournisseur: string) => {
    if (demonstration !== undefined || (oauth !== null && oauth.erreur === null)) return;
    setOauth({ compteId, adresse, fournisseur, etape: "ouverture", erreur: null });
    const parcours = lancerConnexionOAuth(instanceUrl, { compteId, adresse, fournisseur }, (etape) => {
      setOauth((actuel) => (actuel !== null && actuel.compteId === compteId ? { ...actuel, etape } : actuel));
    });
    annulerOauth.current = parcours.annuler;
    void parcours.resultat.then((resultat) => {
      annulerOauth.current = null;
      if (resultat.ok) {
        setEnVerification((actuel) => [...actuel, compteId]);
        setOauth(null);
        setRechargement((n) => n + 1);
      } else if (resultat.annule) {
        setOauth(null);
      } else {
        setOauth((actuel) =>
          actuel !== null && actuel.compteId === compteId ? { ...actuel, erreur: resultat.message } : actuel,
        );
      }
    });
  };

  const connexionEnCours = oauth !== null && oauth.erreur === null;

  return (
    <div data-testid="comptes-messagerie">
      <h3>{fr("Comptes")}</h3>
      <p className="rg-mess__desc">
        {fr("Chaque collaborateur relève sa boîte depuis le serveur du cabinet. Les identifiants sont chiffrés sur le serveur et ne sont jamais enregistrés sur un poste.")}
      </p>
      {sante === null ? (
        <p className="rg-mess__note" role="status" data-testid="comptes-chargement">
          {fr(erreur ?? (enLigne ? "Chargement des boîtes…" : "Consultation possible en ligne seulement."))}
        </p>
      ) : sante.comptes.length === 0 ? (
        <p className="rg-mess__note" data-testid="comptes-aucun">
          {fr("Aucune boîte n'est accessible avec ce compte.")}
        </p>
      ) : (
        <div className="rg-mess__liste" data-testid="comptes-liste">
          {sante.comptes.map((compte) => {
            const presentation = presenterSante(compte);
            const indexation = presenterIndexation(compte);
            const nominatif = compte.typeCompte === "nominatif" && enLigne && demonstration === undefined;
            // Une boîte OAuth n'a rien à modifier : seule sa reconnexion existe, quand le fournisseur a refusé le jeton.
            const modifiable = nominatif && (!compte.oauth || presentation.reconnecter);
            return (
              <div
                key={compte.compteId}
                className="rg-mess__ligne rg-mess__compte-sante"
                data-testid="compte-sante"
                data-compte-id={compte.compteId}
                data-niveau={presentation.niveau}
              >
                <span className="rg-mess__nom">
                  <b>{fr(libelleTypeCompte(compte.typeCompte).titre)}</b>
                  <small data-testid="compte-adresse">{compte.adresse}</small>
                  {presentation.fournisseur !== null ? (
                    <small data-testid="compte-fournisseur">{fr(`Connexion par ${presentation.fournisseur}`)}</small>
                  ) : null}
                  <span className="rg-mess__etat">
                    <span className="rg-mess__puce" data-niveau={presentation.niveau}>
                      <i aria-hidden />
                      <span data-testid="compte-etat">{fr(presentation.titre)}</span>
                    </span>
                    <small data-testid="compte-detail">{fr(presentation.detail)}</small>
                    {indexation === null ? null : (
                      <small data-testid="compte-indexation">{fr(indexation)}</small>
                    )}
                  </span>
                </span>
                {modifiable ? (
                  <span className="rg-mess__boutons">
                    <button
                      type="button"
                      className="rg-mess__bouton"
                      data-fort={presentation.reconnecter ? "true" : undefined}
                      data-testid="compte-reconnecter"
                      disabled={connexionEnCours}
                      onClick={() => {
                        if (compte.oauth) {
                          connecterParFournisseur(compte.compteId, compte.adresse, compte.fournisseur ?? "");
                        } else {
                          ouvrir("reconnexion", compte.compteId, compte.adresse);
                        }
                      }}
                    >
                      {fr(presentation.reconnecter ? "Reconnecter" : "Modifier")}
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {erreur !== null && sante !== null ? (
        <p className="rg-mess__erreur" role="alert" data-testid="comptes-erreur">
          {fr(`Actualisation impossible. ${erreur}`)}
        </p>
      ) : null}
      {formulaire !== null ? (
        <FormulaireConnexionBoite
          key={`${formulaire.mode}-${formulaire.compteId}`}
          mode={formulaire.mode}
          adresse={formulaire.adresse}
          envoiEnCours={envoiEnCours}
          erreur={erreurFormulaire}
          onEnvoyer={envoyer}
          onAnnuler={() => {
            setFormulaire(null);
          }}
        />
      ) : choix !== null ? (
        <ChoixConnexionBoite
          fournisseurs={choix.fournisseurs}
          onMotDePasse={() => {
            ouvrir("ajout", choix.compteId, "");
            setChoix(null);
          }}
          onFournisseur={(fournisseur, adresse) => {
            setChoix(null);
            connecterParFournisseur(choix.compteId, adresse, fournisseur.id);
          }}
          onAnnuler={() => {
            setChoix(null);
          }}
        />
      ) : oauth !== null ? (
        <div
          className="rg-mess__formulaire"
          data-testid="connexion-oauth-progression"
          data-etape={oauth.erreur === null ? oauth.etape : "erreur"}
        >
          {oauth.erreur === null ? (
            <>
              <p className="rg-mess__desc" role="status" data-testid="connexion-oauth-etape">
                {fr(libelleEtape(oauth.etape))}
              </p>
              <p className="rg-mess__note">
                {fr(`Boîte ${oauth.adresse}, connexion par ${libelleFournisseur(oauth.fournisseur)}.`)}
              </p>
              {oauth.etape !== "echange" ? (
                <div className="rg-mess__actions">
                  <button
                    type="button"
                    className="rg-mess__bouton"
                    data-testid="connexion-oauth-annuler"
                    onClick={() => {
                      annulerOauth.current?.();
                    }}
                  >
                    {fr("Annuler")}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="rg-mess__erreur" role="alert" data-testid="connexion-oauth-erreur">
                {fr(oauth.erreur)}
              </p>
              <div className="rg-mess__actions">
                <button
                  type="button"
                  className="rg-mess__bouton"
                  data-testid="connexion-oauth-fermer"
                  onClick={() => {
                    setOauth(null);
                  }}
                >
                  {fr("Fermer")}
                </button>
              </div>
            </>
          )}
        </div>
      ) : enLigne && demonstration === undefined ? (
        <div className="rg-mess__actions">
          <button type="button" className="rg-mess__bouton" data-testid="compte-ajouter" onClick={ouvrirChoix}>
            {fr("Ajouter une boîte")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
