import { useCallback, useEffect, useRef, useState } from "react";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import {
  creerModele,
  ecrireSignatureCompte,
  listerComptes,
  listerModeles,
  lireSignatureCompte,
  modifierModele,
  supprimerModele,
} from "@/messagerie/apiRedactionCabinet";
import { majCache, stockageNavigateur } from "@/messagerie/cacheRedaction";
import type { ModeleMessage } from "@/messagerie/corpsRedaction";
import { EditeurMessage } from "@/messagerie/EditeurMessage";
import {
  libelleTypeCompte,
  problemeModele,
  SIGNATURE_MAX,
  type ChampsModele,
  type CompteMessagerie,
} from "@/messagerie/formesApiRedaction";
import { nettoyerSortie } from "@/messagerie/nettoyageHtml";
import { memoriserModeles } from "@/messagerie/useModeles";

/**
 * Réglages, rubrique Messagerie (maquette prototype-reglages : « Signature » et « Modèles de message »).
 * - Une signature par compte de l'utilisateur, avec la même mise en forme simple que la rédaction ; elle est insérée à
 *   la rédaction d'un message neuf, d'une réponse et d'un transfert.
 * - Les modèles de message du cabinet : créer, modifier, supprimer. Un modèle est réutilisable dès qu'il est
 *   enregistré, sans nouvelle version de l'application.
 * Tout passe par l'API : la modification se fait en ligne.
 */

export type DemonstrationMessagerie = {
  comptes: CompteMessagerie[];
  /** HTML de la signature, par compte. */
  signatures: Record<string, string>;
  modeles: ModeleMessage[];
};

type ReglagesMessagerieProps = {
  instanceUrl: string;
  horsLigne: boolean;
  demonstration?: DemonstrationMessagerie;
};

const MESSAGE_EN_LIGNE = "Modification possible en ligne seulement.";

function identifiantUtilisateur(): string | null {
  return utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
}

// ---------------------------------------------------------------------------------------------
// Signature d'un compte
// ---------------------------------------------------------------------------------------------

type SignatureDuCompteProps = {
  compte: CompteMessagerie;
  instanceUrl: string;
  enLigne: boolean;
  demonstration: boolean;
  htmlDemonstration: string;
};

function SignatureDuCompte({ compte, instanceUrl, enLigne, demonstration, htmlDemonstration }: SignatureDuCompteProps) {
  const [base, setBase] = useState<string | null>(demonstration ? htmlDemonstration : null);
  const [saisie, setSaisie] = useState<string>(demonstration ? htmlDemonstration : "");
  const [message, setMessage] = useState<{ genre: "ok" | "erreur"; texte: string } | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);

  useEffect(() => {
    if (demonstration || !enLigne) return;
    let annule = false;
    void lireSignatureCompte(instanceUrl, compte.id).then((resultat) => {
      if (annule) return;
      if (resultat.ok) {
        setBase(resultat.valeur.html);
        setSaisie(resultat.valeur.html);
      } else {
        setMessage({ genre: "erreur", texte: resultat.message });
      }
    });
    return () => {
      annule = true;
    };
  }, [compte.id, demonstration, enLigne, instanceUrl]);

  const modifiee = base !== null && nettoyerSortie(saisie) !== nettoyerSortie(base);

  const enregistrer = () => {
    const html = nettoyerSortie(saisie);
    if (html.length > SIGNATURE_MAX) {
      setMessage({ genre: "erreur", texte: "La signature est trop longue." });
      return;
    }
    setEnregistrement(true);
    setMessage(null);
    void ecrireSignatureCompte(instanceUrl, compte.id, html).then((resultat) => {
      setEnregistrement(false);
      if (!resultat.ok) {
        setMessage({ genre: "erreur", texte: resultat.statut === 0 ? MESSAGE_EN_LIGNE : resultat.message });
        return;
      }
      const enregistree = resultat.valeur.html;
      majCache(stockageNavigateur(), identifiantUtilisateur(), (cache) => ({
        ...cache,
        signatures: { ...cache.signatures, [compte.id]: enregistree },
      }));
      setBase(enregistree);
      setMessage({ genre: "ok", texte: "Signature enregistrée." });
    });
  };

  const { titre } = libelleTypeCompte(compte.typeCompte);
  const identifiantChamp = `signature-${compte.id}`;

  return (
    <div
      className="rg-mess__signature"
      data-testid="signature-compte"
      data-compte-id={compte.id}
      data-type={compte.typeCompte}
    >
      <p className="rg-mess__compte" id={identifiantChamp}>
        <b>{fr(titre)}</b>
        <small>{compte.adresse}</small>
      </p>
      {base === null ? (
        <p className="rg-mess__note" role="status" data-testid="signature-attente">
          {fr(enLigne ? "Chargement de la signature…" : MESSAGE_EN_LIGNE)}
        </p>
      ) : (
        <>
          <div className="rg-mess__editeur">
            <EditeurMessage
              contenuInitial={base}
              onChange={setSaisie}
              libelle={`Signature, ${titre}`}
              testId="reglages-signature-corps"
            />
          </div>
          <div className="rg-mess__actions">
            <button
              type="button"
              className="rg-mess__bouton"
              data-fort="true"
              data-testid="signature-enregistrer"
              disabled={demonstration || !modifiee || enregistrement || !enLigne}
              onClick={enregistrer}
            >
              {fr(enregistrement ? "Enregistrement" : "Enregistrer la signature")}
            </button>
            {message === null ? null : (
              <span
                className={message.genre === "erreur" ? "rg-mess__erreur" : "rg-mess__confirme"}
                role={message.genre === "erreur" ? "alert" : "status"}
                data-testid={message.genre === "erreur" ? "signature-erreur" : "signature-enregistree"}
              >
                {fr(message.texte)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Modèles de message
// ---------------------------------------------------------------------------------------------

type EditionModele = { cle: number; id: string | null; champs: ChampsModele };

type FormulaireModeleProps = {
  edition: EditionModele;
  enregistrement: boolean;
  erreur: string | null;
  onEnregistrer: (champs: ChampsModele) => void;
  onAnnuler: () => void;
};

function FormulaireModele({ edition, enregistrement, erreur, onEnregistrer, onAnnuler }: FormulaireModeleProps) {
  const [nom, setNom] = useState(edition.champs.nom);
  const [objet, setObjet] = useState(edition.champs.objet);
  const corps = useRef(edition.champs.corpsHtml);
  const [problemeLocal, setProblemeLocal] = useState<string | null>(null);

  const valider = () => {
    const champs: ChampsModele = { nom: nom.trim(), objet: objet.trim(), corpsHtml: nettoyerSortie(corps.current) };
    const probleme = problemeModele(champs);
    setProblemeLocal(probleme);
    if (probleme === null) onEnregistrer(champs);
  };

  return (
    <form
      className="rg-mess__formulaire"
      data-testid="modele-formulaire"
      aria-label={fr(edition.id === null ? "Nouveau modèle de message" : "Modifier le modèle de message")}
      onSubmit={(event) => {
        event.preventDefault();
        valider();
      }}
    >
      <div className="rg-mess__champ">
        <label htmlFor="modele-nom">{fr("Nom du modèle")}</label>
        <input
          id="modele-nom"
          data-testid="modele-nom"
          type="text"
          value={nom}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => {
            setNom(event.target.value);
          }}
        />
      </div>
      <div className="rg-mess__champ">
        <label htmlFor="modele-objet">{fr("Objet")}</label>
        <input
          id="modele-objet"
          data-testid="modele-objet"
          type="text"
          value={objet}
          maxLength={300}
          autoComplete="off"
          onChange={(event) => {
            setObjet(event.target.value);
          }}
        />
      </div>
      <div className="rg-mess__champ">
        <span className="rg-mess__etiquette">{fr("Message")}</span>
        <div className="rg-mess__editeur">
          <EditeurMessage
            key={edition.cle}
            contenuInitial={edition.champs.corpsHtml}
            onChange={(html) => {
              corps.current = html;
            }}
            libelle="Corps du modèle"
            testId="modele-corps"
          />
        </div>
      </div>
      {problemeLocal !== null || erreur !== null ? (
        <p className="rg-mess__erreur" role="alert" data-testid="modele-erreur">
          {fr(problemeLocal ?? erreur ?? "")}
        </p>
      ) : null}
      <div className="rg-mess__actions">
        <button type="submit" className="rg-mess__bouton" data-fort="true" data-testid="modele-enregistrer" disabled={enregistrement}>
          {fr(enregistrement ? "Enregistrement" : "Enregistrer le modèle")}
        </button>
        <button type="button" className="rg-mess__bouton" data-testid="modele-abandon" onClick={onAnnuler}>
          {fr("Annuler")}
        </button>
      </div>
    </form>
  );
}

type ModelesDuCabinetProps = {
  instanceUrl: string;
  enLigne: boolean;
  demonstration: ModeleMessage[] | null;
};

function ModelesDuCabinet({ instanceUrl, enLigne, demonstration }: ModelesDuCabinetProps) {
  const [modeles, setModeles] = useState<ModeleMessage[] | null>(demonstration);
  const [edition, setEdition] = useState<EditionModele | null>(null);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const cle = useRef(0);

  const recharger = useCallback(async (): Promise<void> => {
    const resultat = await listerModeles(instanceUrl);
    if (resultat.ok) {
      memoriserModeles(resultat.valeur);
      setModeles(resultat.valeur);
    } else {
      setErreur(resultat.statut === 0 ? MESSAGE_EN_LIGNE : resultat.message);
    }
  }, [instanceUrl]);

  useEffect(() => {
    if (demonstration !== null || !enLigne) return;
    let annule = false;
    void listerModeles(instanceUrl).then((resultat) => {
      if (annule) return;
      if (resultat.ok) {
        memoriserModeles(resultat.valeur);
        setModeles(resultat.valeur);
      } else {
        setErreur(resultat.statut === 0 ? MESSAGE_EN_LIGNE : resultat.message);
      }
    });
    return () => {
      annule = true;
    };
  }, [demonstration, enLigne, instanceUrl]);

  const ouvrir = (modele: ModeleMessage | null) => {
    cle.current += 1;
    setErreur(null);
    setConfirmation(null);
    setASupprimer(null);
    setEdition({
      cle: cle.current,
      id: modele === null ? null : modele.id,
      champs:
        modele === null
          ? { nom: "", objet: "", corpsHtml: "" }
          : { nom: modele.nom, objet: modele.objet, corpsHtml: modele.corpsHtml },
    });
  };

  const enregistrer = (champs: ChampsModele) => {
    if (edition === null) return;
    setEnregistrement(true);
    setErreur(null);
    const existant = edition.id;
    const operation =
      existant === null
        ? creerModele(instanceUrl, crypto.randomUUID(), champs)
        : modifierModele(instanceUrl, existant, champs);
    void operation.then(async (resultat) => {
      if (!resultat.ok) {
        setEnregistrement(false);
        setErreur(resultat.statut === 0 ? MESSAGE_EN_LIGNE : resultat.message);
        return;
      }
      await recharger();
      setEnregistrement(false);
      setEdition(null);
      setConfirmation(existant === null ? "Modèle créé." : "Modèle modifié.");
    });
  };

  const supprimer = (id: string) => {
    setErreur(null);
    void supprimerModele(instanceUrl, id).then(async (resultat) => {
      if (!resultat.ok) {
        setErreur(resultat.statut === 0 ? MESSAGE_EN_LIGNE : resultat.message);
        return;
      }
      await recharger();
      setASupprimer(null);
      setConfirmation("Modèle supprimé.");
    });
  };

  const lectureSeule = demonstration !== null || !enLigne;

  return (
    <div data-testid="modeles-message">
      {modeles === null ? (
        <p className="rg-mess__note" role="status">
          {fr(enLigne ? "Chargement des modèles…" : MESSAGE_EN_LIGNE)}
        </p>
      ) : modeles.length === 0 ? (
        <p className="rg-mess__note" data-testid="modeles-aucun">
          {fr("Aucun modèle de message pour le moment.")}
        </p>
      ) : (
        <div className="rg-mess__liste" data-testid="modeles-liste">
          {modeles.map((modele) => (
            <div className="rg-mess__ligne" key={modele.id} data-testid="modele-ligne" data-id={modele.id} data-nom={modele.nom}>
              <span className="rg-mess__nom">
                <b>{fr(modele.nom)}</b>
                {modele.objet === "" ? null : <small>{fr(`Objet : ${modele.objet}`)}</small>}
              </span>
              {aSupprimer === modele.id ? (
                <span className="rg-mess__boutons">
                  <button
                    type="button"
                    className="rg-mess__bouton"
                    data-fort="true"
                    data-testid="modele-supprimer-confirmer"
                    onClick={() => {
                      supprimer(modele.id);
                    }}
                  >
                    {fr("Supprimer le modèle")}
                  </button>
                  <button
                    type="button"
                    className="rg-mess__bouton"
                    onClick={() => {
                      setASupprimer(null);
                    }}
                  >
                    {fr("Garder")}
                  </button>
                </span>
              ) : (
                <span className="rg-mess__boutons">
                  <button
                    type="button"
                    className="rg-mess__bouton"
                    data-testid="modele-modifier"
                    disabled={lectureSeule}
                    onClick={() => {
                      ouvrir(modele);
                    }}
                  >
                    {fr("Modifier")}
                  </button>
                  <button
                    type="button"
                    className="rg-mess__bouton"
                    data-testid="modele-supprimer"
                    disabled={lectureSeule}
                    onClick={() => {
                      setConfirmation(null);
                      setASupprimer(modele.id);
                    }}
                  >
                    {fr("Supprimer")}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {edition === null ? (
        <div className="rg-mess__actions">
          <button
            type="button"
            className="rg-mess__bouton"
            data-testid="modele-nouveau"
            disabled={lectureSeule}
            onClick={() => {
              ouvrir(null);
            }}
          >
            {fr("Nouveau modèle")}
          </button>
          {confirmation === null ? null : (
            <span className="rg-mess__confirme" role="status" data-testid="modele-confirmation">
              {fr(confirmation)}
            </span>
          )}
        </div>
      ) : (
        <FormulaireModele
          key={edition.cle}
          edition={edition}
          enregistrement={enregistrement}
          erreur={erreur}
          onEnregistrer={enregistrer}
          onAnnuler={() => {
            setEdition(null);
            setErreur(null);
          }}
        />
      )}
      {edition === null && erreur !== null ? (
        <p className="rg-mess__erreur" role="alert" data-testid="modele-erreur">
          {fr(erreur)}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Rubrique
// ---------------------------------------------------------------------------------------------

export function ReglagesMessagerie({ instanceUrl, horsLigne, demonstration }: ReglagesMessagerieProps) {
  const [comptes, setComptes] = useState<CompteMessagerie[] | null>(demonstration?.comptes ?? null);
  const [erreurComptes, setErreurComptes] = useState<string | null>(null);

  useEffect(() => {
    if (demonstration !== undefined || horsLigne) return;
    let annule = false;
    void listerComptes(instanceUrl).then((resultat) => {
      if (annule) return;
      if (resultat.ok) setComptes(resultat.valeur);
      else setErreurComptes(resultat.statut === 0 ? MESSAGE_EN_LIGNE : resultat.message);
    });
    return () => {
      annule = true;
    };
  }, [demonstration, horsLigne, instanceUrl]);

  const enLigne = demonstration !== undefined || !horsLigne;

  return (
    <section className="rg-mess" data-testid="reglages-messagerie" aria-labelledby="reglages-messagerie-titre">
      <h2 id="reglages-messagerie-titre">{fr("Messagerie")}</h2>
      {enLigne ? null : (
        <p className="rg-mess__note" role="status" data-testid="reglages-messagerie-hors-ligne">
          {fr(MESSAGE_EN_LIGNE)}
        </p>
      )}

      <h3>{fr("Signature")}</h3>
      <p className="rg-mess__desc">
        {fr("Une signature par boîte. Elle est insérée à la rédaction d'un nouveau mail, de chaque réponse et de chaque transfert.")}
      </p>
      {comptes === null ? (
        <p className="rg-mess__note" role="status">
          {fr(erreurComptes ?? (enLigne ? "Chargement des boîtes…" : MESSAGE_EN_LIGNE))}
        </p>
      ) : comptes.length === 0 ? (
        <p className="rg-mess__note" data-testid="signature-aucun-compte">
          {fr("Aucune boîte n'est accessible avec ce compte.")}
        </p>
      ) : (
        comptes.map((compte) => (
          <SignatureDuCompte
            key={compte.id}
            compte={compte}
            instanceUrl={instanceUrl}
            enLigne={enLigne}
            demonstration={demonstration !== undefined}
            htmlDemonstration={demonstration?.signatures[compte.id] ?? ""}
          />
        ))
      )}

      <h3>{fr("Modèles de message")}</h3>
      <p className="rg-mess__desc">
        {fr("Les modèles sont ceux du cabinet. Un modèle enregistré est proposé tout de suite dans la rédaction, bouton « Modèle ».")}
      </p>
      <ModelesDuCabinet instanceUrl={instanceUrl} enLigne={enLigne} demonstration={demonstration?.modeles ?? null} />
    </section>
  );
}
