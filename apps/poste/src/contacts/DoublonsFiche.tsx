import { useState } from "react";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { assurerJetonAcces } from "@/lib/session/rafraichir";

type Doublon = { id: string; nom: string; motif: string };

type DoublonsFicheProps = {
  contactId: string;
  horsLigne?: boolean;
  instanceUrl?: string;
};

const MOTIFS: Record<string, string> = {
  siren: "même SIREN",
  email: "même adresse e-mail",
  identite: "mêmes nom, prénoms et date de naissance",
};

export function DoublonsFiche({ contactId, horsLigne = false, instanceUrl }: DoublonsFicheProps) {
  const [doublons, setDoublons] = useState<Doublon[]>([]);
  const [message, setMessage] = useState("");
  const [champs, setChamps] = useState<Record<string, boolean>>({});
  const enLigne = instanceUrl !== undefined && !horsLigne;

  const chercher = () => {
    if (instanceUrl === undefined || horsLigne) return;
    setMessage("");
    void (async () => {
      const jeton = await assurerJetonAcces();
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
        if (!reponse.ok) {
          const corps = json as { message?: string } | null;
          setMessage(corps?.message ?? "La recherche de doublons a échoué.");
          return;
        }
        setDoublons(Array.isArray(json) ? (json as Doublon[]) : []);
      } catch {
        setMessage("La recherche de doublons a échoué.");
      }
    })();
  };

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
        setDoublons((etat) => etat.filter((doublon) => doublon.id !== absorbeeId));
      } catch {
        setMessage("La fusion a échoué.");
      }
    })();
  };

  return (
    <div className="flex flex-col gap-2" data-testid="contacts-doublons">
      <button
        type="button"
        className="filtre self-start"
        data-testid="contacts-doublons-chercher"
        disabled={!enLigne}
        onClick={chercher}
      >
        {fr("Chercher les doublons")}
      </button>
      {!enLigne ? (
        <p className="message-attention" data-testid="contacts-doublons-hors-ligne">
          {fr("Hors ligne : la fusion se fait en ligne.")}
        </p>
      ) : null}
      {doublons.map((doublon) => (
        <div key={`${doublon.id}-${doublon.motif}`} data-testid="contacts-doublon">
          <p>{fr(`${doublon.nom} — ${MOTIFS[doublon.motif] ?? doublon.motif}`)}</p>
          <label className="mr-3">
            <input
              type="checkbox"
              data-testid="contacts-doublon-prenoms"
              checked={champs.prenoms === true}
              onChange={(event) => {
                setChamps((etat) => ({ ...etat, prenoms: event.target.checked }));
              }}
            />
            {fr("Prendre les prénoms")}
          </label>
          <button
            type="button"
            className="filtre"
            data-testid="contacts-doublon-fusionner"
            onClick={() => {
              fusionner(doublon.id);
            }}
          >
            {fr("Fusionner")}
          </button>
        </div>
      ))}
      {message !== "" ? <p data-testid="contacts-doublons-message">{fr(message)}</p> : null}
    </div>
  );
}
