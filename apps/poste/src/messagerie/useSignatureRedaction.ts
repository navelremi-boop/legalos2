import { useEffect, useState } from "react";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import { compteDeComposition, DELAI_OUVERTURE_MS, lireSignatureCompte } from "@/messagerie/apiRedactionCabinet";
import { lireCache, majCache, stockageNavigateur } from "@/messagerie/cacheRedaction";
import type { GenreRedaction } from "@/messagerie/citation";

/**
 * Signature du compte d'envoi d'un message qui s'ouvre. Elle vient d'abord de la copie gardée sur ce poste (le volet
 * s'ouvre tout de suite, même sans réseau), puis du serveur, qui fait foi : si le compte ou le texte diffèrent, la
 * nouvelle signature remplace la première tant que l'utilisateur n'a rien écrit (c'est `VoletRedaction` qui le décide).
 *
 * Le compte est celui du message d'origine (réponse, transfert) ou la boîte du cabinet (message neuf) ; le serveur
 * le désigne, sauf quand le poste le connaît déjà avec certitude (`compteConnu`).
 */

export type SignatureResolue = { compteId: string; html: string };

/** `chargement` : réponse du serveur attendue ; `prete` : signature connue (vide ou non) ; `indisponible` : ni serveur ni copie. */
export type EtatSignature = "chargement" | "prete" | "indisponible";

export type EntreeSignature = {
  instanceUrl: string;
  /** Faux pour un brouillon repris, une démonstration : aucune signature n'est cherchée ni insérée. */
  actif: boolean;
  genre: GenreRedaction;
  messageId: string | null;
  compteConnu: string | null;
};

type Resultat = { signature: SignatureResolue | null; etat: EtatSignature };

function depuisCopie(entree: EntreeSignature): SignatureResolue | null {
  if (!entree.actif) return null;
  const utilisateurId = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
  const cache = lireCache(stockageNavigateur(), utilisateurId);
  if (cache === null) return null;
  const compteId = entree.compteConnu ?? (entree.genre === "nouveau" ? cache.compteNouveau : null);
  if (compteId === null) return null;
  const html = cache.signatures[compteId];
  return html === undefined ? null : { compteId, html };
}

export function useSignatureRedaction(entree: EntreeSignature): Resultat {
  const { instanceUrl, actif, genre, messageId, compteConnu } = entree;
  const [resultat, setResultat] = useState<Resultat>(() => {
    const copie = depuisCopie(entree);
    return { signature: copie, etat: !actif || copie !== null ? "prete" : "chargement" };
  });

  useEffect(() => {
    if (!actif) return;
    const controle = { annule: false };
    const utilisateurId = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
    void (async () => {
      let compteId = compteConnu;
      let statutEchec: number | null = null;
      if (compteId === null) {
        const compte = await compteDeComposition(instanceUrl, genre, messageId, DELAI_OUVERTURE_MS);
        if (compte.ok) {
          compteId = compte.valeur;
          if (genre === "nouveau" && compteId !== null) {
            const ouvert = compteId;
            majCache(stockageNavigateur(), utilisateurId, (cache) => ({ ...cache, compteNouveau: ouvert }));
          }
        } else {
          statutEchec = compte.statut;
        }
      }
      if (compteId !== null) {
        const lue = await lireSignatureCompte(instanceUrl, compteId, DELAI_OUVERTURE_MS);
        if (controle.annule) return;
        if (lue.ok) {
          const identifiant = compteId;
          const html = lue.valeur.html;
          majCache(stockageNavigateur(), utilisateurId, (cache) => ({
            ...cache,
            signatures: { ...cache.signatures, [identifiant]: html },
          }));
          setResultat({ signature: { compteId: identifiant, html }, etat: "prete" });
          return;
        }
        statutEchec = lue.statut;
      }
      if (controle.annule) return;
      // Serveur injoignable ou session expirée : on garde la copie du poste, sinon on le dit. Toute autre réponse du
      // serveur (compte inconnu, messagerie non configurée) veut dire : pas de signature pour ce message.
      setResultat((actuel) => ({
        signature: actuel.signature,
        etat: actuel.signature !== null || (statutEchec !== 0 && statutEchec !== 401) ? "prete" : "indisponible",
      }));
    })();
    return () => {
      controle.annule = true;
    };
  }, [actif, compteConnu, genre, instanceUrl, messageId]);

  return resultat;
}
