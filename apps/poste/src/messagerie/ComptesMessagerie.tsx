import { useCallback, useEffect, useState } from "react";
import { fr } from "@/lib/fr";
import { ajouterBoite, reconnecterBoite } from "@/messagerie/apiConnexionBoites";
import { lireSanteMessagerie } from "@/messagerie/apiSanteMessagerie";
import { FormulaireConnexionBoite } from "@/messagerie/FormulaireConnexionBoite";
import { libelleTypeCompte } from "@/messagerie/formesApiRedaction";
import { verificationTerminee, type ChampsConnexion, type ModeConnexion } from "@/messagerie/formesConnexionBoite";
import { presenterSante, type SanteMessagerie } from "@/messagerie/formesSanteMessagerie";

/**
 * Réglages, Messagerie, « Comptes » (maquette prototype-reglages) : chaque boîte avec son état de connexion, sa dernière
 * relève et ses envois en échec ; ajout d'une boîte et reconnexion d'une boîte dont les identifiants sont refusés.
 * L'état vient du serveur (`GET /messagerie/sante`) et se rafraîchit tout seul ; le poste ne tient aucun identifiant de
 * messagerie : ceux du formulaire partent au serveur et disparaissent avec lui.
 */

const RAFRAICHISSEMENT_MS = 30_000;
/** Pendant la vérification d'une connexion : le moteur essaie dans les secondes qui suivent. */
const RAFRAICHISSEMENT_RAPIDE_MS = 3_000;

type FormulaireOuvert = { mode: ModeConnexion; compteId: string; adresse: string };

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
            const modifiable = compte.typeCompte === "nominatif" && enLigne && demonstration === undefined;
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
                  <span className="rg-mess__etat">
                    <span className="rg-mess__puce" data-niveau={presentation.niveau}>
                      <i aria-hidden />
                      <span data-testid="compte-etat">{fr(presentation.titre)}</span>
                    </span>
                    <small data-testid="compte-detail">{fr(presentation.detail)}</small>
                  </span>
                </span>
                {modifiable ? (
                  <span className="rg-mess__boutons">
                    <button
                      type="button"
                      className="rg-mess__bouton"
                      data-fort={presentation.reconnecter ? "true" : undefined}
                      data-testid="compte-reconnecter"
                      onClick={() => {
                        ouvrir("reconnexion", compte.compteId, compte.adresse);
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
      ) : enLigne && demonstration === undefined ? (
        <div className="rg-mess__actions">
          <button
            type="button"
            className="rg-mess__bouton"
            data-testid="compte-ajouter"
            onClick={() => {
              ouvrir("ajout", crypto.randomUUID(), "");
            }}
          >
            {fr("Ajouter une boîte")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
