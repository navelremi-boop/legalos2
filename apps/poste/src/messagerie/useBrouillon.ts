import { useCallback, useEffect, useRef, useState } from "react";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import {
  ecrireBrouillonSurServeur,
  envoyerBrouillon,
  retirerPiece,
  televerserPiece,
  traiterEnvoi,
} from "@/messagerie/apiBrouillons";
import {
  attendreFileVide,
  dernierRefus,
  ecrituresEnAttente,
  enregistrerBrouillon,
  lireBrouillon,
  supprimerBrouillon,
} from "@/messagerie/brouillons";
import {
  champsEcrits,
  corpsNonTouche,
  estIntact,
  verifierEnvoi,
  type ChampsEcrits,
  type EtatRedaction,
  type StatutEnregistrement,
} from "@/messagerie/etatRedaction";
import {
  lirePiecesBrouillon,
  piecesAffichees,
  verifierAjout,
  type PieceAffichee,
  type PieceBrouillon,
} from "@/messagerie/piecesRedaction";
import type { RemplacementEditeur } from "@/messagerie/EditeurMessage";
import { getPowerSyncDatabase } from "@/sync/database";

/**
 * Cycle de vie d'un message en cours de rédaction : enregistrement automatique dans la base locale (donc hors
 * ligne), état d'envoi au serveur, pièces jointes en ligne, envoi par la file d'envoi. Aucun SQL ici : la base
 * passe par `brouillons.ts`, le réseau par `apiBrouillons.ts`.
 */

const DELAI_ENREGISTREMENT_MS = 700;
const DELAI_FILE_VIDE_MS = 8_000;
const PAUSE_SURVEILLANCE_MS = 1_000;

export type EntreeBrouillon = {
  depart: EtatRedaction;
  /** Colonnes déjà en base (brouillon repris) ; `null` pour une rédaction qui n'a encore rien enregistré. */
  precedent: ChampsEcrits | null;
  modifieLe: string | null;
  instanceUrl: string;
  /** Noms des pièces du message d'origine (un transfert les conserve). */
  piecesDuMessage: readonly string[];
  piecesInitiales: readonly PieceBrouillon[];
  /** Démonstration : aucune écriture, aucun appel. */
  hors: boolean;
  onEnvoye: () => void;
  onSupprime: () => void;
};

export type RetourBrouillon = {
  etat: EtatRedaction;
  modifier: (changements: Partial<EtatRedaction>) => void;
  /**
   * Change le départ du message (signature) tant que l'utilisateur n'a pas touché au corps : le nouveau départ devient
   * la référence et n'est pas enregistré à lui seul. Faux (rien changé) dès que l'utilisateur a écrit dans le corps.
   * Le HTML produit est montré dans l'éditeur.
   */
  remplacerDepart: (fabriquer: (courant: EtatRedaction) => Partial<EtatRedaction>) => boolean;
  /**
   * Choisit le compte d'envoi d'un message neuf. Le serveur fixe le compte à la création du brouillon : le choix n'est
   * possible que tant que rien n'a été enregistré (faux ensuite). Le compte choisi devient le départ : il n'est pas
   * enregistré à lui seul, et il part avec la première saisie.
   */
  choisirCompte: (compteId: string | null) => boolean;
  /** Vrai dès que le brouillon est enregistré : le compte d'envoi ne change plus. */
  compteFige: boolean;
  /** Change le corps et l'objet à la demande de l'utilisateur (modèle) : enregistré comme une saisie. */
  remplacerSaisie: (changements: Pick<EtatRedaction, "corpsHtml" | "objet">) => void;
  /** Dernier contenu imposé à l'éditeur ; `null` : l'éditeur a la main depuis l'ouverture. */
  remplacement: RemplacementEditeur | null;
  statut: StatutEnregistrement;
  pieces: PieceAffichee[];
  ajouterFichiers: (fichiers: readonly File[]) => void;
  retirerPieceJointe: (cle: string) => void;
  ecarterPiece: (cle: string) => void;
  envoyer: () => void;
  supprimer: () => void;
  erreur: string | null;
  envoiEnCours: boolean;
  pieceEnCours: boolean;
};

function identifiantPiece(): string {
  return crypto.randomUUID();
}

export function useBrouillon(entree: EntreeBrouillon): RetourBrouillon {
  const { depart, precedent, modifieLe, instanceUrl, piecesDuMessage, hors, onEnvoye, onSupprime } = entree;
  const [etat, setEtat] = useState<EtatRedaction>(depart);
  const [statut, setStatut] = useState<StatutEnregistrement>(
    precedent === null || modifieLe === null
      ? { genre: "vierge" }
      : { genre: "serveur", a: new Date(modifieLe.replace(" ", "T")) },
  );
  const [piecesServeur, setPiecesServeur] = useState<PieceBrouillon[]>([...entree.piecesInitiales]);
  const [piecesEnCours, setPiecesEnCours] = useState<PieceAffichee[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [compteFige, setCompteFige] = useState(precedent !== null);
  const [remplacement, setRemplacement] = useState<RemplacementEditeur | null>(null);

  const etatRef = useRef(etat);
  const departRef = useRef(depart);
  const precedentRef = useRef<ChampsEcrits | null>(precedent);
  const minuterie = useRef<number | null>(null);
  const file = useRef<Promise<void>>(Promise.resolve());
  const ferme = useRef(false);
  const operationsPieces = useRef(0);
  const piecesServeurRef = useRef(piecesServeur);
  useEffect(() => {
    piecesServeurRef.current = piecesServeur;
  }, [piecesServeur]);
  const piecesEnCoursRef = useRef(piecesEnCours);
  useEffect(() => {
    piecesEnCoursRef.current = piecesEnCours;
  }, [piecesEnCours]);

  const enfiler = useCallback((tache: () => Promise<void>): Promise<void> => {
    file.current = file.current.then(tache, tache);
    return file.current;
  }, []);

  /** Écrit dans la base locale ce qui a changé. Un départ intact (réponse non touchée) n'est pas enregistré. */
  const vider = useCallback(
    (forcer: boolean): Promise<void> =>
      enfiler(async () => {
        if (hors || ferme.current) return;
        const courant = etatRef.current;
        if (precedentRef.current === null && !forcer && estIntact(courant, departRef.current)) {
          setStatut((actuel) => (actuel.genre === "enregistrement" ? { genre: "vierge" } : actuel));
          return;
        }
        try {
          const base = await getPowerSyncDatabase();
          const jeton = loadSessionTokens().accessToken;
          const resultat = await enregistrerBrouillon(base, {
            etat: courant,
            precedent: precedentRef.current,
            auteurId: utilisateurIdDepuisJeton(jeton),
            maintenant: new Date(),
          });
          precedentRef.current = champsEcrits(courant);
          setCompteFige(true);
          if (resultat.creation || resultat.colonnes.length > 0) {
            setStatut({ genre: "local", a: resultat.instant, enLigne: base.currentStatus.connected });
          } else {
            setStatut((actuel) => (actuel.genre === "enregistrement" ? { genre: "local", a: resultat.instant, enLigne: base.currentStatus.connected } : actuel));
          }
        } catch {
          setStatut({ genre: "refuse", message: "L'écriture sur cet appareil a échoué." });
        }
      }),
    [enfiler, hors],
  );

  const planifier = useCallback(() => {
    if (hors) return;
    setStatut({ genre: "enregistrement" });
    if (minuterie.current !== null) window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => {
      minuterie.current = null;
      void vider(false);
    }, DELAI_ENREGISTREMENT_MS);
  }, [hors, vider]);

  const modifier = useCallback(
    (changements: Partial<EtatRedaction>) => {
      const suivant = { ...etatRef.current, ...changements };
      etatRef.current = suivant;
      setEtat(suivant);
      planifier();
    },
    [planifier],
  );

  const montrer = useCallback((html: string, curseur?: "debut") => {
    setRemplacement((actuel) => ({ cle: (actuel?.cle ?? 0) + 1, html, curseur }));
  }, []);

  const remplacerDepart = useCallback(
    (fabriquer: (courant: EtatRedaction) => Partial<EtatRedaction>): boolean => {
      if (hors || ferme.current || !corpsNonTouche(etatRef.current, departRef.current)) return false;
      const changements = fabriquer(etatRef.current);
      departRef.current = { ...departRef.current, ...changements };
      const suivant = { ...etatRef.current, ...changements };
      etatRef.current = suivant;
      setEtat(suivant);
      if (changements.corpsHtml !== undefined) montrer(changements.corpsHtml, "debut");
      // Un départ qui change sans que rien d'autre ne soit écrit n'est pas enregistré à lui seul.
      if (precedentRef.current !== null || !estIntact(suivant, departRef.current)) planifier();
      return true;
    },
    [hors, montrer, planifier],
  );

  const choisirCompte = useCallback(
    (compteId: string | null): boolean => {
      if (ferme.current || precedentRef.current !== null) return false;
      departRef.current = { ...departRef.current, compteId };
      const suivant = { ...etatRef.current, compteId };
      etatRef.current = suivant;
      setEtat(suivant);
      return true;
    },
    [],
  );

  const remplacerSaisie = useCallback(
    (changements: Pick<EtatRedaction, "corpsHtml" | "objet">) => {
      modifier(changements);
      montrer(changements.corpsHtml);
    },
    [modifier, montrer],
  );

  // À la fermeture du volet (autre mail, autre écran), ce qui est en attente est écrit tout de suite.
  useEffect(() => {
    return () => {
      if (minuterie.current !== null) {
        window.clearTimeout(minuterie.current);
        minuterie.current = null;
      }
      void vider(false);
    };
  }, [vider]);

  // Surveillance : le brouillon est « visible sur vos autres appareils » quand la file d'envoi du poste est vide.
  useEffect(() => {
    if (hors) return;
    const controle = { arret: false };
    const arrete = () => controle.arret;
    const tour = () => {
      void (async () => {
        try {
          const base = await getPowerSyncDatabase();
          const id = etatRef.current.id;
          const ligne = await lireBrouillon(base, id);
          if (arrete()) return;
          if (ligne !== null && operationsPieces.current === 0) {
            const lues = lirePiecesBrouillon(ligne.pieces_texte);
            setPiecesServeur((actuelles) => (JSON.stringify(actuelles) === JSON.stringify(lues) ? actuelles : lues));
          }
          const enAttente = await ecrituresEnAttente(base);
          if (arrete()) return;
          setStatut((actuel) => {
            if (actuel.genre === "local" && enAttente === 0 && base.currentStatus.connected) {
              return { genre: "serveur", a: actuel.a };
            }
            if (actuel.genre === "local") {
              return { genre: "local", a: actuel.a, enLigne: base.currentStatus.connected };
            }
            return actuel;
          });
          if (enAttente === 0) {
            const refus = await dernierRefus(base, id);
            if (!arrete() && refus !== null) {
              setStatut((actuel) =>
                actuel.genre === "local" || actuel.genre === "serveur" ? { genre: "refuse", message: refus } : actuel,
              );
            }
          }
        } catch {
          /* la base n'est pas prête : on réessaie au tour suivant */
        }
      })();
    };
    tour();
    const minuteur = window.setInterval(tour, PAUSE_SURVEILLANCE_MS);
    return () => {
      controle.arret = true;
      window.clearInterval(minuteur);
    };
  }, [hors]);

  /** Le serveur a la dernière version du brouillon : écriture locale, puis écriture directe du brouillon complet. */
  const assurerSurServeur = useCallback(async (): Promise<string | null> => {
    await vider(true);
    const resultat = await ecrireBrouillonSurServeur(instanceUrl, etatRef.current.id, champsEcrits(etatRef.current));
    if (!resultat.ok) {
      return resultat.statut === 0
        ? "Le serveur est injoignable : cette action se fait en ligne. Le brouillon reste enregistré sur cet appareil."
        : resultat.message;
    }
    setPiecesServeur(resultat.valeur);
    return null;
  }, [instanceUrl, vider]);

  const ajouterFichiers = useCallback(
    (fichiers: readonly File[]) => {
      if (hors || fichiers.length === 0) return;
      setErreur(null);
      operationsPieces.current += 1;
      void (async () => {
        try {
          // Les pièces déjà au serveur et celles en cours d'envoi comptent dans le cumul.
          let connues: PieceBrouillon[] = [
            ...piecesServeurRef.current,
            ...piecesEnCoursRef.current
              .filter((piece) => piece.etat === "en-cours")
              .map((piece) => ({ id: piece.cle, nom: piece.nom, type_mime: "", taille: piece.taille ?? 0 })),
          ];
          const acceptes: { fichier: File; cle: string }[] = [];
          const refus: PieceAffichee[] = [];
          for (const fichier of fichiers) {
            const verdict = verifierAjout(connues, { nom: fichier.name, taille: fichier.size });
            if (verdict.ok) {
              const cle = identifiantPiece();
              acceptes.push({ fichier, cle });
              connues = [...connues, { id: cle, nom: fichier.name, type_mime: fichier.type, taille: fichier.size }];
            } else {
              refus.push({ cle: identifiantPiece(), id: null, nom: fichier.name, taille: fichier.size, etat: "refusee", message: verdict.message });
            }
          }
          setPiecesEnCours((actuelles) => [
            ...actuelles,
            ...refus,
            ...acceptes.map(({ fichier, cle }) => ({
              cle,
              id: null,
              nom: fichier.name,
              taille: fichier.size,
              etat: "en-cours" as const,
            })),
          ]);
          if (acceptes.length === 0) return;
          const impossible = await assurerSurServeur();
          if (impossible !== null) {
            setPiecesEnCours((actuelles) =>
              actuelles.map((piece) =>
                acceptes.some((a) => a.cle === piece.cle) ? { ...piece, etat: "refusee", message: impossible } : piece,
              ),
            );
            return;
          }
          for (const { fichier, cle } of acceptes) {
            const resultat = await televerserPiece(instanceUrl, etatRef.current.id, fichier, cle);
            if (resultat.ok) {
              setPiecesServeur(resultat.valeur);
              setPiecesEnCours((actuelles) => actuelles.filter((piece) => piece.cle !== cle));
            } else {
              setPiecesEnCours((actuelles) =>
                actuelles.map((piece) =>
                  piece.cle === cle
                    ? {
                        ...piece,
                        etat: "refusee",
                        message:
                          resultat.statut === 0
                            ? "Le serveur est injoignable : réessayez en ligne."
                            : resultat.message,
                      }
                    : piece,
                ),
              );
            }
          }
        } finally {
          operationsPieces.current -= 1;
        }
      })();
    },
    [assurerSurServeur, hors, instanceUrl],
  );

  const retirerPieceJointe = useCallback(
    (cle: string) => {
      if (hors) return;
      setErreur(null);
      operationsPieces.current += 1;
      void (async () => {
        try {
          const impossible = await assurerSurServeur();
          if (impossible !== null) {
            setErreur(impossible);
            return;
          }
          const resultat = await retirerPiece(instanceUrl, etatRef.current.id, cle);
          if (resultat.ok) setPiecesServeur(resultat.valeur);
          else setErreur(resultat.statut === 0 ? "Le serveur est injoignable : réessayez en ligne." : resultat.message);
        } finally {
          operationsPieces.current -= 1;
        }
      })();
    },
    [assurerSurServeur, hors, instanceUrl],
  );

  const ecarterPiece = useCallback((cle: string) => {
    setPiecesEnCours((actuelles) => actuelles.filter((piece) => piece.cle !== cle));
  }, []);

  const envoyer = useCallback(() => {
    if (hors) return;
    setErreur(null);
    const verdict = verifierEnvoi(etatRef.current, operationsPieces.current > 0);
    if (!verdict.ok) {
      setErreur(verdict.message);
      return;
    }
    setEnvoiEnCours(true);
    void (async () => {
      try {
        if (minuterie.current !== null) {
          window.clearTimeout(minuterie.current);
          minuterie.current = null;
        }
        await vider(true);
        const base = await getPowerSyncDatabase();
        // Les écritures du poste partent avant l'envoi : un envoi qui précède une écriture la ferait refuser.
        await attendreFileVide(base, DELAI_FILE_VIDE_MS);
        const impossible = await assurerSurServeur();
        if (impossible !== null) {
          setErreur(impossible);
          return;
        }
        const resultat = await envoyerBrouillon(instanceUrl, etatRef.current.id);
        if (!resultat.ok) {
          setErreur(resultat.statut === 0 ? "Le serveur est injoignable : l'envoi se fait en ligne. Le brouillon est conservé." : resultat.message);
          return;
        }
        ferme.current = true;
        // La file d'envoi mène le message jusqu'à « copie dans Envoyés confirmée » ; l'écran suit son état dans le rail.
        void traiterEnvoi(instanceUrl, resultat.valeur.id);
        onEnvoye();
      } finally {
        setEnvoiEnCours(false);
      }
    })();
  }, [assurerSurServeur, hors, instanceUrl, onEnvoye, vider]);

  const supprimer = useCallback(() => {
    if (minuterie.current !== null) {
      window.clearTimeout(minuterie.current);
      minuterie.current = null;
    }
    ferme.current = true;
    if (hors) {
      onSupprime();
      return;
    }
    void (async () => {
      try {
        await file.current;
        if (precedentRef.current !== null) {
          const base = await getPowerSyncDatabase();
          await supprimerBrouillon(base, etatRef.current.id);
        }
      } catch {
        /* rien à retirer */
      } finally {
        onSupprime();
      }
    })();
  }, [hors, onSupprime]);

  const pieces = piecesAffichees(piecesServeur, etat.genre, piecesDuMessage, piecesEnCours);
  return {
    etat,
    modifier,
    remplacerDepart,
    choisirCompte,
    compteFige,
    remplacerSaisie,
    remplacement,
    statut,
    pieces,
    ajouterFichiers,
    retirerPieceJointe,
    ecarterPiece,
    envoyer,
    supprimer,
    erreur,
    envoiEnCours,
    pieceEnCours: piecesEnCours.some((piece) => piece.etat === "en-cours"),
  };
}
