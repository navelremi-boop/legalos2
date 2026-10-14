import { useEffect, useState } from "react";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";
import { listerModeles } from "@/messagerie/apiRedactionCabinet";
import { lireCache, majCache, stockageNavigateur } from "@/messagerie/cacheRedaction";
import type { ModeleMessage } from "@/messagerie/corpsRedaction";

/**
 * Modèles de message du cabinet pour le choix dans la rédaction : la copie gardée sur ce poste d'abord (hors ligne,
 * ouverture immédiate), puis la liste du serveur, qui la remplace. `enLigne` dit si la dernière lecture a réussi.
 */

export type ModelesDisponibles = {
  modeles: ModeleMessage[];
  /** `false` quand le serveur n'a pas répondu : la liste est alors la dernière copie du poste, ou vide. */
  enLigne: boolean;
};

/** Copie des modèles pour le poste, après une lecture ou une modification réussie. */
export function memoriserModeles(modeles: readonly ModeleMessage[]): void {
  const utilisateurId = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
  majCache(stockageNavigateur(), utilisateurId, (cache) => ({ ...cache, modeles: [...modeles] }));
}

export function useModeles(instanceUrl: string, actif: boolean): ModelesDisponibles {
  const [etat, setEtat] = useState<ModelesDisponibles>(() => {
    const utilisateurId = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
    const copie = actif ? lireCache(stockageNavigateur(), utilisateurId) : null;
    return { modeles: copie?.modeles ?? [], enLigne: true };
  });

  useEffect(() => {
    if (!actif) return;
    let annule = false;
    void listerModeles(instanceUrl).then((resultat) => {
      if (annule) return;
      if (resultat.ok) {
        memoriserModeles(resultat.valeur);
        setEtat({ modeles: resultat.valeur, enLigne: true });
      } else {
        setEtat((actuel) => ({ modeles: actuel.modeles, enLigne: false }));
      }
    });
    return () => {
      annule = true;
    };
  }, [actif, instanceUrl]);

  return etat;
}
