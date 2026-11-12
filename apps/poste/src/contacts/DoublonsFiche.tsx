import { useEffect, useState } from "react";
import { IconGitMerge } from "@tabler/icons-react";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { assurerJetonAcces } from "@/lib/session/rafraichir";

export type DoublonDetecte = { id: string; nom: string; motif: string };

type DoublonsFicheProps = {
  contactId: string;
  horsLigne?: boolean;
  instanceUrl?: string;
  /** Doublons figés de la galerie : affichés sans appeler l'instance. */
  doublonsFixes?: readonly DoublonDetecte[];
};

/** Fin de la phrase de l'alerte, d'après la maquette : « La fiche « … » porte le même SIREN. » */
const MOTIFS: Record<string, string> = {
  siren: "porte le même SIREN",
  email: "porte la même adresse e-mail",
  identite: "porte les mêmes nom, prénoms et date de naissance",
};

/**
 * Doublons de la fiche, détectés par l'instance à l'ouverture de la fiche (en ligne seulement) et
 * signalés par une alerte passive ; « Comparer et fusionner » ouvre le choix des champs et la fusion.
 */
export function DoublonsFiche({ contactId, horsLigne = false, instanceUrl, doublonsFixes }: DoublonsFicheProps) {
  const [doublons, setDoublons] = useState<readonly DoublonDetecte[]>(doublonsFixes ?? []);
  const [message, setMessage] = useState("");
  const [champs, setChamps] = useState<Record<string, boolean>>({});
  const [ouvert, setOuvert] = useState<string | null>(null);
  const enLigne = instanceUrl !== undefined && !horsLigne;
  const fixe = doublonsFixes !== undefined;

  useEffect(() => {
    if (fixe || instanceUrl === undefined || horsLigne) return;
    const arret = new AbortController();
    const arrete = () => arret.signal.aborted;
    void (async () => {
      const jeton = await assurerJetonAcces();
      if (arrete()) return;
      if (jeton === null) {
        setMessage("La session a expiré. Reconnectez-vous.");
        return;
      }
      try {
        const reponse = await fetch(apiUrl(instanceUrl, `/contacts/${contactId}/doublons`), {
          headers: { authorization: `Bearer ${jeton}` },
          signal: AbortSignal.timeout(12_000),
        });
        const json: unknown = await reponse.json().catch(() => null);
        if (arrete()) return;
        if (!reponse.ok) {
          const corps = json as { message?: string } | null;
          setMessage(corps?.message ?? "La recherche de doublons a échoué.");
          return;
        }
        setDoublons(Array.isArray(json) ? (json as DoublonDetecte[]) : []);
      } catch {
        if (!arrete()) setMessage("La recherche de doublons a échoué.");
      }
    })();
    return () => {
      arret.abort();
    };
  }, [contactId, fixe, horsLigne, instanceUrl]);

  const fusionner = (absorbeeId: string) => {
    if (instanceUrl === undefined || horsLigne) return;
    const retenus = Object.entries(champs)
      .filter(([, coche]) => coche)
      .map(([champ]) => champ);
    void (async () => {
      const jeton = await assurerJetonAcces();
      if (jeton === null) {
        setMessage("La session a expiré. Reconnectez-vous.");
        return;
      }
      try {
        const reponse = await fetch(apiUrl(instanceUrl, `/contacts/${contactId}/fusion`), {
          method: "POST",
          headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
          body: JSON.stringify({
            idempotence_cle: crypto.randomUUID(),
            absorbee_id: absorbeeId,
            champs_absorbes: retenus,
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const json: unknown = await reponse.json().catch(() => null);
        if (!reponse.ok) {
          const corps = json as { message?: string } | null;
          setMessage(corps?.message ?? "La fusion a échoué.");
          return;
        }
        setMessage("Fusion enregistrée.");
        setOuvert(null);
        setDoublons((etat) => etat.filter((doublon) => doublon.id !== absorbeeId));
      } catch {
        setMessage("La fusion a échoué.");
      }
    })();
  };

  if (doublons.length === 0 && message === "" && !horsLigne) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="contacts-doublons">
      {doublons.map((doublon) => (
        <div key={`${doublon.id}-${doublon.motif}`} data-testid="contacts-doublon">
          <div className="alerte">
            <IconGitMerge size={16} stroke={1.7} aria-hidden />
            <div>
              <b>{fr("Doublon possible.")}</b>{" "}
              {fr(`La fiche « ${doublon.nom} » ${MOTIFS[doublon.motif] ?? doublon.motif}.`)}
            </div>
            <button
              type="button"
              className="contacts-act act"
              data-testid="contacts-doublon-comparer"
              aria-expanded={ouvert === doublon.id}
              onClick={() => {
                setOuvert((etat) => (etat === doublon.id ? null : doublon.id));
              }}
            >
              {fr("Comparer et fusionner")}
            </button>
          </div>
          {ouvert === doublon.id ? (
            <div className="flex flex-wrap items-center gap-3 px-1" data-testid="contacts-doublon-fusion">
              <label>
                <input
                  type="checkbox"
                  data-testid="contacts-doublon-prenoms"
                  checked={champs.prenoms === true}
                  onChange={(event) => {
                    setChamps((etat) => ({ ...etat, prenoms: event.target.checked }));
                  }}
                />{" "}
                {fr(`Prendre les prénoms de « ${doublon.nom} »`)}
              </label>
              <button
                type="button"
                className="contacts-act act"
                data-testid="contacts-doublon-fusionner"
                disabled={!enLigne}
                title={enLigne ? undefined : fr("La fusion se fait en ligne.")}
                onClick={() => {
                  fusionner(doublon.id);
                }}
              >
                {fr("Fusionner dans cette fiche")}
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {horsLigne ? (
        <p className="message-attention" data-testid="contacts-doublons-hors-ligne">
          {fr("Hors ligne : les doublons se détectent et se fusionnent en ligne.")}
        </p>
      ) : null}
      {message !== "" ? <p data-testid="contacts-doublons-message">{fr(message)}</p> : null}
    </div>
  );
}
