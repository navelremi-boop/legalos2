import { useState } from "react";
import { apiUrl } from "@/lib/auth/client";
import {
  champsRetenus,
  lignesProposition,
  type ChampImport,
  type PropositionSiren,
} from "@/contacts/propositionSiren";
import { dirigeantsDepuisJson } from "@/contacts/dirigeants";
import { DirigeantsProposes } from "@/contacts/DirigeantsProposes";
import type { ContactListe } from "@/contacts/listeContacts";
import { fr } from "@/lib/fr";
import { formatDateActe } from "@/lib/format";
import { assurerJetonAcces } from "@/lib/session/rafraichir";

const COCHES_VIDES: Record<ChampImport, boolean> = {
  denomination: false,
  forme: false,
  adresseSiege: false,
  activite: false,
};

type PropositionImportProps = {
  contact: ContactListe;
  horsLigne?: boolean;
  instanceUrl?: string;
  /** Proposition figée de la galerie. Sans instance, le bouton l'affiche. */
  propositionFixe?: PropositionSiren | null;
  contacts?: readonly ContactListe[];
  onCreer?: (contact: ContactListe) => void;
};

function lireProposition(json: unknown): PropositionSiren | null {
  if (json === null || typeof json !== "object") return null;
  const ligne = json as Record<string, unknown>;
  const texte = (cle: string): string | null => (typeof ligne[cle] === "string" ? ligne[cle] : null);
  if (typeof ligne.siren !== "string") return null;
  return {
    siren: ligne.siren,
    denomination: texte("denomination"),
    forme: texte("forme"),
    adresseSiege: texte("adresse_siege"),
    activite: texte("activite"),
    dirigeants: dirigeantsDepuisJson(ligne.dirigeants),
  };
}

export function PropositionImport({
  contact,
  horsLigne = false,
  instanceUrl,
  propositionFixe = null,
  contacts = [],
  onCreer,
}: PropositionImportProps) {
  const [proposition, setProposition] = useState<PropositionSiren | null>(null);
  const [coches, setCoches] = useState<Record<ChampImport, boolean>>(COCHES_VIDES);
  const [message, setMessage] = useState("");
  const [source, setSource] = useState("");
  const siren = contact.siren?.trim() ?? "";
  if (contact.nature !== "morale" || siren === "") return null;

  const interroger = () => {
    setMessage("");
    setCoches(COCHES_VIDES);
    if (propositionFixe !== null) {
      setProposition(propositionFixe);
      return;
    }
    if (instanceUrl === undefined) {
      setMessage("La saisie manuelle reste possible.");
      return;
    }
    void (async () => {
      const jeton = await assurerJetonAcces();
      if (jeton === null) {
        setMessage("La session a expiré. Reconnectez-vous.");
        return;
      }
      try {
        const reponse = await fetch(apiUrl(instanceUrl, `/contacts/recherche-siren/${siren}`), {
          headers: { authorization: `Bearer ${jeton}` },
          signal: AbortSignal.timeout(12_000),
        });
        const json: unknown = await reponse.json().catch(() => null);
        if (!reponse.ok) {
          const corps = json as { message?: string } | null;
          setProposition(null);
          setMessage(corps?.message ?? "Le registre des entreprises est indisponible. La saisie manuelle reste possible.");
          return;
        }
        const lue = lireProposition(json);
        if (lue === null) {
          setMessage("Le registre des entreprises est indisponible. La saisie manuelle reste possible.");
          return;
        }
        setProposition(lue);
      } catch {
        setProposition(null);
        setMessage("Le registre des entreprises est indisponible. La saisie manuelle reste possible.");
      }
    })();
  };

  const lignes = proposition === null ? [] : lignesProposition(contact, proposition);
  const retenus = proposition === null ? {} : champsRetenus(proposition, coches);
  const enregistrer = () => {
    if (Object.keys(retenus).length === 0) {
      setMessage("Aucun champ retenu.");
      return;
    }
    setMessage("");
    if (instanceUrl === undefined || propositionFixe !== null) {
      setSource("Source : Recherche d'entreprises.");
      return;
    }
    const adresseId = retenus.adresseSiege === undefined ? undefined : crypto.randomUUID();
    void (async () => {
      const jeton = await assurerJetonAcces();
      if (jeton === null) {
        setMessage("La session a expiré. Reconnectez-vous.");
        return;
      }
      try {
        const reponse = await fetch(apiUrl(instanceUrl, `/contacts/${contact.id}/import-siren`), {
          method: "POST",
          headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
          body: JSON.stringify({
            idempotence_cle: crypto.randomUUID(),
            denomination: retenus.denomination,
            forme: retenus.forme,
            activite: retenus.activite,
            adresse_siege: retenus.adresseSiege,
            adresse_id: adresseId,
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const json: unknown = await reponse.json().catch(() => null);
        if (!reponse.ok) {
          const corps = json as { message?: string } | null;
          setMessage(corps?.message ?? "L'import n'a pas été enregistré.");
          return;
        }
        const importe =
          json !== null && typeof json === "object" && typeof (json as { importe_le?: unknown }).importe_le === "string"
            ? (json as { importe_le: string }).importe_le
            : "";
        const jour = formatDateActe(importe.slice(0, 10));
        setSource(jour === "" ? "Source : Recherche d'entreprises." : `Source : Recherche d'entreprises, le ${jour}.`);
      } catch {
        setMessage("L'import n'a pas été enregistré. La saisie manuelle reste possible.");
      }
    })();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="contacts-import">
      <button
        type="button"
        className="filtre self-start"
        data-testid="contacts-import-siren"
        disabled={horsLigne}
        onClick={interroger}
      >
        {fr("Interroger le registre")}
      </button>
      {horsLigne ? (
        <p className="message-attention" data-testid="contacts-import-hors-ligne">
          {fr("Hors ligne : la saisie manuelle reste possible.")}
        </p>
      ) : null}
      {message !== "" ? (
        <p className="message-attention" data-testid="contacts-import-message">
          {fr(message)}
        </p>
      ) : null}
      {proposition !== null ? (
        <div data-testid="contacts-import-proposition">
          <p className="text-[length:var(--font-size-dense)] text-graphite">
            {fr("Le capital et le greffe ne figurent pas au registre : ils restent à saisir.")}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {lignes.map((ligne) => (
              <li key={ligne.champ} className="grid grid-cols-[auto_1fr_1fr] gap-2">
                <label>
                  <input
                    type="checkbox"
                    data-testid={`contacts-import-retenir-${ligne.champ}`}
                    checked={coches[ligne.champ]}
                    onChange={(event) => {
                      setCoches((etat) => ({ ...etat, [ligne.champ]: event.target.checked }));
                    }}
                  />
                  <span className="sr-only">{fr(`Retenir ${ligne.libelle}`)}</span>
                </label>
                <p data-testid={`contacts-import-ancien-${ligne.champ}`}>{fr(`${ligne.libelle} : ${ligne.ancien}`)}</p>
                <p data-testid={`contacts-import-registre-${ligne.champ}`}>{fr(ligne.registre)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2" data-testid="contacts-import-retenu">
            {fr(
              lignes.filter((ligne) => retenus[ligne.champ] !== undefined).length === 0
                ? "Aucun champ retenu."
                : `Champs retenus : ${lignes
                    .filter((ligne) => retenus[ligne.champ] !== undefined)
                    .map((ligne) => ligne.libelle)
                    .join(", ")}.`,
            )}
          </p>
          <button
            type="button"
            className="filtre mt-2"
            data-testid="contacts-import-enregistrer"
            disabled={Object.keys(retenus).length === 0}
            onClick={enregistrer}
          >
            {fr("Enregistrer la sélection")}
          </button>
          {source !== "" ? (
            <p className="mt-2" data-testid="contacts-import-source">
              {fr(source)}
            </p>
          ) : null}
          <DirigeantsProposes
            dirigeants={proposition.dirigeants ?? []}
            contacts={contacts}
            onCreer={(contact) => {
              onCreer?.(contact);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
