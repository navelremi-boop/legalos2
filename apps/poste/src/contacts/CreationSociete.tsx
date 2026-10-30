import { useState } from "react";
import { apiUrl } from "@/lib/auth/client";
import { preparerCreation } from "@/contacts/creerSociete";
import { champsFicheVides, libelleCapital, type ContactListe } from "@/contacts/listeContacts";
import { champsRetenus, lignesProposition, type PropositionSiren } from "@/contacts/propositionSiren";
import { fr } from "@/lib/fr";
import { assurerJetonAcces } from "@/lib/session/rafraichir";

type CreationSocieteProps = {
  horsLigne?: boolean;
  instanceUrl?: string;
  propositionFixe?: PropositionSiren | null;
  onCreee: (contact: ContactListe) => void;
  onFermer: () => void;
};

const FICHE_VIDE = { nom: "", forme: null, adresseSiege: null, activite: null };

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
  };
}

export function CreationSociete({
  horsLigne = false,
  instanceUrl,
  propositionFixe = null,
  onCreee,
  onFermer,
}: CreationSocieteProps) {
  const [siren, setSiren] = useState("");
  const [denomination, setDenomination] = useState("");
  const [forme, setForme] = useState("");
  const [activite, setActivite] = useState("");
  const [adresse, setAdresse] = useState("");
  const [greffe, setGreffe] = useState("");
  const [capital, setCapital] = useState("");
  const [proposition, setProposition] = useState<PropositionSiren | null>(null);
  const [coches, setCoches] = useState({ denomination: false, forme: false, adresseSiege: false, activite: false });
  const [message, setMessage] = useState("");
  const [source, setSource] = useState("");

  const interroger = () => {
    setMessage("");
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
        const reponse = await fetch(apiUrl(instanceUrl, `/contacts/recherche-siren/${encodeURIComponent(siren.trim())}`), {
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

  const retenir = (champ: "denomination" | "forme" | "adresseSiege" | "activite", coche: boolean) => {
    setCoches((etat) => ({ ...etat, [champ]: coche }));
    if (proposition === null) return;
    const valeur =
      champ === "denomination"
        ? proposition.denomination
        : champ === "forme"
          ? proposition.forme
          : champ === "adresseSiege"
            ? proposition.adresseSiege
            : proposition.activite;
    const texte = coche ? (valeur ?? "") : "";
    if (champ === "denomination") setDenomination(texte);
    if (champ === "forme") setForme(texte);
    if (champ === "adresseSiege") setAdresse(texte);
    if (champ === "activite") setActivite(texte);
  };

  const creer = () => {
    setMessage("");
    let fiche;
    try {
      fiche = preparerCreation({
        siren,
        denomination,
        forme,
        activite,
        adresse,
        greffe,
        capitalEuros: capital,
        depuisRegistre: proposition !== null,
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Création impossible.");
      return;
    }
    const contact: ContactListe = {
      id: crypto.randomUUID(),
      nature: "morale",
      nom: fiche.nom,
      siren: fiche.siren,
      numeroTva: null,
      typeClient: "professionnel",
      professionReglementee: false,
      ...champsFicheVides(),
      forme: fiche.forme,
      activite: fiche.activite,
      adresseSiege: fiche.adresseSiege,
      greffe: fiche.greffe,
      capitalLibelle: fiche.capitalCentimes === null ? null : libelleCapital(fiche.capitalCentimes, "EUR"),
    };
    if (instanceUrl === undefined || propositionFixe !== null) {
      onCreee(contact);
      setSource(fiche.depuisRegistre ? "Source : Recherche d'entreprises." : "Fiche créée.");
      return;
    }
    void (async () => {
      const jeton = await assurerJetonAcces();
      if (jeton === null) {
        setMessage("La session a expiré. Reconnectez-vous.");
        return;
      }
      try {
        const reponse = await fetch(apiUrl(instanceUrl, "/contacts"), {
          method: "POST",
          headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
          body: JSON.stringify({
            id: contact.id,
            idempotence_cle: crypto.randomUUID(),
            nature: "morale",
            nom: fiche.nom,
            siren: fiche.siren,
            type_client: "professionnel",
            forme: fiche.forme,
            activite: fiche.activite,
            greffe_rcs: fiche.greffe,
            capital_centimes: fiche.capitalCentimes,
            monnaie: fiche.capitalCentimes === null ? null : "EUR",
            depuis_registre: fiche.depuisRegistre,
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const json: unknown = await reponse.json().catch(() => null);
        if (!reponse.ok) {
          const corps = json as { message?: string } | null;
          setMessage(corps?.message ?? "La fiche n'a pas été créée.");
          return;
        }
        if (fiche.adresseSiege !== null) {
          await fetch(apiUrl(instanceUrl, `/contacts/${contact.id}/coordonnees`), {
            method: "POST",
            headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
            body: JSON.stringify({
              id: crypto.randomUUID(),
              idempotence_cle: crypto.randomUUID(),
              genre: "adresse",
              usage: "siege",
              valeur: fiche.adresseSiege,
              principale: true,
            }),
          });
        }
        onCreee(contact);
        setSource(fiche.depuisRegistre ? "Source : Recherche d'entreprises." : "Fiche créée.");
      } catch {
        setMessage("La fiche n'a pas été créée. La saisie manuelle reste possible.");
      }
    })();
  };

  const lignes = proposition === null ? [] : lignesProposition(FICHE_VIDE, proposition);
  const retenus = proposition === null ? {} : champsRetenus(proposition, coches);

  return (
    <div className="flex flex-col gap-3 px-6 py-5" data-testid="contacts-creation">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[length:var(--font-size-section)] font-extrabold">{fr("Nouvelle société")}</h2>
        <button type="button" className="filtre" onClick={onFermer}>
          {fr("Fermer")}
        </button>
      </div>
      <label className="block">
        <span className="mb-1 block text-[length:var(--font-size-dense)]">{fr("SIREN")}</span>
        <input
          className="champ w-full"
          data-testid="contacts-creation-siren"
          value={siren}
          onChange={(event) => {
            setSiren(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="filtre self-start"
        data-testid="contacts-creation-interroger"
        disabled={horsLigne || siren.trim() === ""}
        onClick={interroger}
      >
        {fr("Interroger le registre")}
      </button>
      {horsLigne ? (
        <p className="message-attention">{fr("Hors ligne : la saisie manuelle reste possible.")}</p>
      ) : null}
      {proposition !== null ? (
        <div data-testid="contacts-creation-proposition">
          <p className="text-[length:var(--font-size-dense)] text-graphite">
            {fr("Le capital et le greffe ne figurent pas au registre : ils restent à saisir.")}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {lignes.map((ligne) => (
              <li key={ligne.champ} className="grid grid-cols-[auto_1fr_1fr] gap-2">
                <input
                  type="checkbox"
                  data-testid={`contacts-creation-retenir-${ligne.champ}`}
                  checked={coches[ligne.champ]}
                  onChange={(event) => {
                    retenir(ligne.champ, event.target.checked);
                  }}
                />
                <p data-testid={`contacts-creation-ancien-${ligne.champ}`}>{fr(`${ligne.libelle} : ${ligne.ancien}`)}</p>
                <p data-testid={`contacts-creation-registre-${ligne.champ}`}>{fr(ligne.registre)}</p>
              </li>
            ))}
          </ul>
          <p className="sr-only">{Object.keys(retenus).length}</p>
        </div>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-[length:var(--font-size-dense)]">{fr("Dénomination")}</span>
        <input
          className="champ w-full"
          data-testid="contacts-creation-denomination"
          value={denomination}
          onChange={(event) => {
            setDenomination(event.target.value);
          }}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[length:var(--font-size-dense)]">{fr("Capital (euros)")}</span>
        <input
          className="champ w-full"
          data-testid="contacts-creation-capital"
          value={capital}
          onChange={(event) => {
            setCapital(event.target.value);
          }}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[length:var(--font-size-dense)]">{fr("Greffe du RCS")}</span>
        <input
          className="champ w-full"
          data-testid="contacts-creation-greffe"
          value={greffe}
          onChange={(event) => {
            setGreffe(event.target.value);
          }}
        />
      </label>
      <button type="button" className="filtre self-start" data-testid="contacts-creation-creer" onClick={creer}>
        {fr("Créer la fiche")}
      </button>
      {message !== "" ? (
        <p className="message-attention" data-testid="contacts-creation-message">
          {fr(message)}
        </p>
      ) : null}
      {source !== "" ? (
        <p data-testid="contacts-creation-source">{fr(source)}</p>
      ) : null}
    </div>
  );
}
