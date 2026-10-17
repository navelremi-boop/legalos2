import { useCallback, useEffect, useRef, useState } from "react";
import { IconSend } from "@tabler/icons-react";
import { fr } from "@/lib/fr";
import type { Destinataire } from "@/messagerie/adressesRedaction";
import { suggererDestinataires } from "@/messagerie/apiBrouillons";
import { aUnHistorique } from "@/messagerie/citation";
import {
  avecSignature,
  phraseConfirmationModele,
  planModele,
  type ModeleMessage,
  type PlanModele,
} from "@/messagerie/corpsRedaction";
import { ChampDestinataires } from "@/messagerie/ChampDestinataires";
import {
  fusionnerSuggestions,
  suggestionsLocales,
  type SuggestionDestinataire,
} from "@/messagerie/completion";
import { EditeurMessage } from "@/messagerie/EditeurMessage";
import { libelleStatut, titreRedaction } from "@/messagerie/etatRedaction";
import { etiquetteDossier, type DossierClassement } from "@/messagerie/classement";
import { libelleCompteEnvoi } from "@/messagerie/boitesMail";
import type { CompteLocal, MailLocal } from "@/messagerie/typesMails";
import { useBrouillon, type EntreeBrouillon } from "@/messagerie/useBrouillon";
import { PanneauModeles } from "@/messagerie/PanneauModeles";
import { useModeles } from "@/messagerie/useModeles";
import { useSignatureRedaction } from "@/messagerie/useSignatureRedaction";
import { ZonePieces } from "@/messagerie/ZonePieces";

type VoletRedactionProps = Omit<EntreeBrouillon, "hors"> & {
  /** Mails de la base locale : complétion des destinataires quand l'API est injoignable. */
  mails: readonly MailLocal[];
  adressesPropres: readonly string[];
  dossiers: ReadonlyMap<string, DossierClassement>;
  demonstration: boolean;
  /** Vrai pour un message qui s'ouvre (neuf, réponse, transfert) : sa signature est insérée. Faux pour un brouillon repris. */
  signatureActive: boolean;
  /** Compte d'envoi que le poste connaît avec certitude (le serveur le désigne, sinon). */
  compteConnu: string | null;
  /** Comptes depuis lesquels écrire (ma boîte, boîtes partagées) : le choix « De » d'un message neuf. */
  comptesEnvoi: readonly CompteLocal[];
};

function libelleDossier(dossier: DossierClassement): string {
  const reference = etiquetteDossier(dossier);
  return reference === dossier.nom ? dossier.nom : `${reference}, ${dossier.nom}`;
}

/**
 * Rédaction à la place du volet de lecture (maquette prototype-mails) : à, cc, cci avec complétion ; objet ;
 * dossier de rangement ; éditeur ; pièces par glisser-déposer ; historique cité ; envoi par la file d'envoi.
 * Le brouillon s'enregistre tout seul sur l'appareil, donc hors ligne, et rejoint le serveur dès que possible.
 */
export function VoletRedaction({
  mails,
  adressesPropres,
  dossiers,
  demonstration,
  signatureActive,
  compteConnu,
  comptesEnvoi,
  ...entree
}: VoletRedactionProps) {
  const brouillon = useBrouillon({ ...entree, hors: demonstration });
  const { etat, modifier, remplacerDepart, choisirCompte } = brouillon;
  const signature = useSignatureRedaction({
    instanceUrl: entree.instanceUrl,
    actif: signatureActive && !demonstration,
    genre: entree.depart.genre,
    messageId: entree.depart.origineMessageId,
    compteConnu: etat.compteId ?? compteConnu,
  });
  const signatureAppliquee = useRef<string | null>(null);
  const { modeles, enLigne: modelesEnLigne } = useModeles(entree.instanceUrl, !demonstration);
  const [modelesOuverts, setModelesOuverts] = useState(false);
  const [aConfirmer, setAConfirmer] = useState<{ modele: ModeleMessage; plan: PlanModele } | null>(null);
  const [ccOuvert, setCcOuvert] = useState(etat.cc.length > 0);
  const [cciOuvert, setCciOuvert] = useState(etat.cci.length > 0);
  const [historiqueMasque, setHistoriqueMasque] = useState(etat.genre === "reponse" || etat.genre === "reponse_a_tous");
  const [survol, setSurvol] = useState(false);
  const [dossierOuvert, setDossierOuvert] = useState(false);
  const entrees = useRef(0);
  const choixFichier = useRef<HTMLInputElement>(null);
  const [contenuInitial] = useState(etat.corpsHtml);
  const instanceUrl = entree.instanceUrl;
  // Un message neuf choisit son compte tant que rien n'est enregistré ; une réponse ou un transfert part du compte du
  // message d'origine, un brouillon enregistré garde le sien (le serveur fixe le compte à la création).
  const compteDeDepart = comptesEnvoi.find((compte) => compte.id === (etat.compteId ?? compteConnu));
  const deChoisissable = etat.genre === "nouveau" && comptesEnvoi.length > 0 && !brouillon.compteFige;

  const suggerer = useCallback(
    async (saisie: string): Promise<SuggestionDestinataire[]> => {
      const locales = suggestionsLocales(saisie, mails, adressesPropres);
      if (demonstration) return locales;
      const distantes = await suggererDestinataires(instanceUrl, saisie);
      return distantes.ok ? fusionnerSuggestions(distantes.valeur, locales, []) : locales;
    },
    [adressesPropres, demonstration, instanceUrl, mails],
  );

  // La signature du compte d'envoi entre une seule fois, sous la saisie et avant l'historique ; si le compte ou le texte
  // de la signature changent avant que l'utilisateur ait écrit dans le corps, la nouvelle remplace l'ancienne.
  const signatureResolue = signature.signature;
  useEffect(() => {
    if (signatureResolue === null) return;
    const cle = `${signatureResolue.compteId}|${signatureResolue.html}`;
    if (signatureAppliquee.current === cle) return;
    signatureAppliquee.current = cle;
    remplacerDepart((courant) => {
      const suivant = avecSignature(courant.corpsHtml, signatureResolue.html);
      return suivant === courant.corpsHtml ? {} : { corpsHtml: suivant };
    });
  }, [signatureResolue, remplacerDepart]);

  const appliquerPlan = (plan: PlanModele) => {
    brouillon.remplacerSaisie({ corpsHtml: plan.corpsHtml, objet: plan.objet });
    setAConfirmer(null);
    setModelesOuverts(false);
  };

  const choisirModele = (modele: ModeleMessage) => {
    const plan = planModele({ genre: etat.genre, objet: etat.objet, corpsHtml: etat.corpsHtml }, modele);
    if (plan.confirmation) {
      setAConfirmer({ modele, plan });
      return;
    }
    appliquerPlan(plan);
  };

  const changerAdresses = (champ: "a" | "cc" | "cci") => (valeur: Destinataire[]) => {
    modifier({ [champ]: valeur });
  };

  const glisseDeFichiers = (types: readonly string[]) => types.includes("Files");
  const dossier = etat.dossierId === null ? undefined : dossiers.get(etat.dossierId);
  const dossiersTries = [...dossiers.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  return (
    <form
      className="mails-redac"
      data-testid="mails-redaction"
      data-genre={etat.genre}
      data-brouillon-id={etat.id}
      data-chemise={dossier?.chemise}
      data-survol={survol ? "true" : "false"}
      aria-label={fr("Rédaction d'un mail")}
      onSubmit={(event) => {
        event.preventDefault();
      }}
      onDragEnter={(event) => {
        if (!glisseDeFichiers(event.dataTransfer.types)) return;
        entrees.current += 1;
        setSurvol(true);
      }}
      onDragOver={(event) => {
        if (!glisseDeFichiers(event.dataTransfer.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!glisseDeFichiers(event.dataTransfer.types)) return;
        entrees.current = Math.max(0, entrees.current - 1);
        if (entrees.current === 0) setSurvol(false);
      }}
      onDrop={(event) => {
        if (!glisseDeFichiers(event.dataTransfer.types)) return;
        event.preventDefault();
        entrees.current = 0;
        setSurvol(false);
        brouillon.ajouterFichiers(Array.from(event.dataTransfer.files));
      }}
    >
      {survol ? (
        <div className="mails-redac__depot" data-testid="redac-depot" aria-hidden>
          {fr("Déposez les fichiers pour les joindre")}
        </div>
      ) : null}
      <div className="mails-redac__tete">
        <h3 data-testid="redac-titre">{fr(titreRedaction(etat.genre))}</h3>
        <span className="mails-redac__etat" role="status" data-testid="redac-statut" data-statut={brouillon.statut.genre}>
          {libelleStatut(brouillon.statut)}
        </span>
      </div>

      <div className="mails-redac__champ">
        <label className="mails-redac__l" htmlFor="redac-de-choix">
          {fr("De")}
        </label>
        {deChoisissable ? (
          <span className="mails-redac__de" data-testid="redac-de">
            <select
              id="redac-de-choix"
              data-testid="redac-de-choix"
              value={etat.compteId ?? ""}
              onChange={(event) => {
                choisirCompte(event.target.value === "" ? null : event.target.value);
              }}
            >
              <option value="">{fr("Boîte d'envoi du cabinet")}</option>
              {comptesEnvoi.map((compte) => (
                <option key={compte.id} value={compte.id}>
                  {fr(libelleCompteEnvoi(compte))}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <span data-testid="redac-de" id="redac-de-choix">
            {fr(compteDeDepart === undefined ? "Boîte d'envoi du cabinet" : libelleCompteEnvoi(compteDeDepart))}
          </span>
        )}
        <span />
      </div>

      <ChampDestinataires
        champ="a"
        libelle="À"
        valeur={etat.a}
        onChange={changerAdresses("a")}
        suggerer={suggerer}
        focusInitial={etat.a.length === 0}
        droite={
          <>
            {ccOuvert ? null : (
              <button
                type="button"
                className="mails-redac__lien-champ"
                data-testid="redac-ouvrir-cc"
                onClick={() => {
                  setCcOuvert(true);
                }}
              >
                {fr("Cc")}
              </button>
            )}
            {cciOuvert ? null : (
              <button
                type="button"
                className="mails-redac__lien-champ"
                data-testid="redac-ouvrir-cci"
                onClick={() => {
                  setCciOuvert(true);
                }}
              >
                {fr("Cci")}
              </button>
            )}
          </>
        }
      />
      {ccOuvert ? (
        <ChampDestinataires champ="cc" libelle="Cc" valeur={etat.cc} onChange={changerAdresses("cc")} suggerer={suggerer} />
      ) : null}
      {cciOuvert ? (
        <ChampDestinataires champ="cci" libelle="Cci" valeur={etat.cci} onChange={changerAdresses("cci")} suggerer={suggerer} />
      ) : null}

      <div className="mails-redac__champ">
        <label htmlFor="redac-objet">{fr("Objet")}</label>
        <input
          id="redac-objet"
          data-testid="redac-objet"
          type="text"
          value={etat.objet}
          maxLength={300}
          onChange={(event) => {
            modifier({ objet: event.target.value });
          }}
        />
        <span />
      </div>

      <div className="mails-redac__champ">
        <label htmlFor="redac-dossier">{fr("Dossier")}</label>
        <span className="mails-redac__dossier">
          {dossierOuvert ? (
            <select
              id="redac-dossier"
              data-testid="redac-dossier"
              value={etat.dossierId ?? ""}
              onChange={(event) => {
                modifier({ dossierId: event.target.value === "" ? null : event.target.value });
                setDossierOuvert(false);
              }}
            >
              <option value="">{fr("Aucun dossier choisi")}</option>
              {dossiersTries.map((candidat) => (
                <option key={candidat.id} value={candidat.id}>
                  {fr(libelleDossier(candidat))}
                </option>
              ))}
            </select>
          ) : dossier === undefined ? (
            <span className="mails-redac__dossier-note" data-testid="redac-dossier-note">
              {fr("Aucun dossier choisi")}
            </span>
          ) : (
            <span className="mails-redac__dossier-note" data-testid="redac-dossier-note">
              <span className="mails-dos" data-chemise={dossier.chemise}>
                <i aria-hidden />
                {fr(etiquetteDossier(dossier))}
              </span>
              {fr(`${dossier.nom}, une copie de l'envoi y sera rangée`)}
            </span>
          )}
        </span>
        <button
          type="button"
          className="mails-redac__lien-champ"
          data-testid="redac-dossier-changer"
          onClick={() => {
            setDossierOuvert((courant) => !courant);
          }}
        >
          {fr(dossier === undefined ? "Choisir" : "Changer")}
        </button>
      </div>

      {signature.etat === "indisponible" ? (
        <p className="mails-redac__note" role="status" data-testid="signature-indisponible">
          {fr("Votre signature n'a pas pu être chargée : le serveur est injoignable.")}
        </p>
      ) : null}

      <EditeurMessage
        contenuInitial={contenuInitial}
        historiqueMasque={historiqueMasque}
        remplacement={brouillon.remplacement}
        onJoindre={() => {
          choixFichier.current?.click();
        }}
        onChange={(html) => {
          modifier({ corpsHtml: html });
        }}
        outilsSupplementaires={
          demonstration ? null : (
            <button
              type="button"
              className="mails-redac__outil mails-redac__outil--texte"
              data-testid="outil-modele"
              aria-expanded={modelesOuverts}
              onClick={() => {
                setModelesOuverts((courant) => !courant);
                setAConfirmer(null);
              }}
            >
              {fr("Modèle")}
            </button>
          )
        }
        panneaux={
          modelesOuverts ? (
            <PanneauModeles
              modeles={modeles}
              enLigne={modelesEnLigne}
              onChoisir={choisirModele}
              confirmation={
                aConfirmer === null
                  ? null
                  : { modele: aConfirmer.modele, phrase: phraseConfirmationModele(aConfirmer.modele.nom, aConfirmer.plan.remplace) }
              }
              onConfirmer={() => {
                // Le plan est refait au moment de confirmer : ce que l'utilisateur a écrit depuis le choix est vu.
                if (aConfirmer !== null) {
                  appliquerPlan(
                    planModele({ genre: etat.genre, objet: etat.objet, corpsHtml: etat.corpsHtml }, aConfirmer.modele),
                  );
                }
              }}
              onAnnuler={() => {
                setAConfirmer(null);
              }}
            />
          ) : null
        }
      />
      <input
        ref={choixFichier}
        className="sr-only"
        type="file"
        multiple
        tabIndex={-1}
        aria-label={fr("Choisir des pièces jointes")}
        data-testid="redac-fichier"
        onChange={(event) => {
          brouillon.ajouterFichiers(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <ZonePieces
        pieces={brouillon.pieces}
        onRetirer={brouillon.retirerPieceJointe}
        onEcarter={brouillon.ecarterPiece}
        transfert={etat.genre === "transfert"}
      />

      {aUnHistorique(etat.corpsHtml) ? (
        <div className="mails-redac__histo">
          <button
            type="button"
            data-testid="redac-histo"
            aria-expanded={!historiqueMasque}
            onClick={() => {
              setHistoriqueMasque((courant) => !courant);
            }}
          >
            {fr(historiqueMasque ? "Afficher le message d'origine" : "Masquer le message d'origine")}
          </button>
        </div>
      ) : null}

      {brouillon.erreur !== null ? (
        <p className="mails-erreur" role="alert" data-testid="redac-erreur">
          {fr(brouillon.erreur)}
        </p>
      ) : null}

      <div className="mails-redac__pied">
        <button
          type="button"
          className="mails-redac__envoyer"
          data-testid="redac-envoyer"
          disabled={brouillon.envoiEnCours}
          onClick={brouillon.envoyer}
        >
          <IconSend stroke={1.8} aria-hidden />
          {fr(brouillon.envoiEnCours ? "Envoi en cours" : "Envoyer")}
        </button>
        <span className="mails-redac__info">
          {fr("Envoi garanti par la file d'envoi,")}
          <br />
          {fr("même si la connexion coupe.")}
        </span>
        <button type="button" className="mails-redac__supprimer" data-testid="redac-supprimer" onClick={brouillon.supprimer}>
          {fr("Supprimer le brouillon")}
        </button>
      </div>
    </form>
  );
}
