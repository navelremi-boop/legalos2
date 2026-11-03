import { useEffect, useRef, useState } from "react";
import { IconBuildingBank, IconGitMerge } from "@tabler/icons-react";
import {
  champsDepuisProposition,
  communeRetenue,
  controleSiren,
  doublonSiren,
  optionsCommune,
  optionsForme,
  tvaCalculee,
} from "@/contacts/creationContact";
import { contactDepuisSociete, corpsCreationSociete, preparerCreation } from "@/contacts/creerSociete";
import { DirigeantsProposes } from "@/contacts/DirigeantsProposes";
import { chercherSirenRegistre, enregistrerContact } from "@/contacts/enregistrerContact";
import { libelleListeContact, type ContactListe } from "@/contacts/listeContacts";
import { propositionDepuisJson, type PropositionSiren } from "@/contacts/propositionSiren";
import { fr } from "@/lib/fr";

type CreationSocieteProps = {
  horsLigne?: boolean;
  instanceUrl?: string;
  propositionFixe?: PropositionSiren | null;
  contacts?: readonly ContactListe[];
  /** Place le curseur dans le champ SIREN (« Importer par SIREN »). */
  focusSiren?: boolean;
  /** La fiche est enregistrée : l'écran l'ouvre. */
  onCreee: (contact: ContactListe) => void;
  /** Fiche créée pour un dirigeant proposé : elle rejoint la liste sans quitter le formulaire. */
  onDirigeantCree: (contact: ContactListe) => void;
  /** Ouvre la fiche déjà présente dans l'annuaire. */
  onOuvrir: (id: string) => void;
  onAnnuler: () => void;
};

/** Formulaire de création d'une personne morale, d'après le rendu de création de la maquette. */
export function CreationSociete({
  horsLigne = false,
  instanceUrl,
  propositionFixe = null,
  contacts = [],
  focusSiren = false,
  onCreee,
  onDirigeantCree,
  onOuvrir,
  onAnnuler,
}: CreationSocieteProps) {
  const [siren, setSiren] = useState("");
  const [denomination, setDenomination] = useState("");
  const [forme, setForme] = useState("");
  const [capital, setCapital] = useState("");
  const [greffe, setGreffe] = useState("");
  const [tvaManuelle, setTvaManuelle] = useState<string | null>(null);
  const [voie, setVoie] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [commune, setCommune] = useState("");
  const [activite, setActivite] = useState("");
  const [proposition, setProposition] = useState<PropositionSiren | null>(null);
  const [aideSiren, setAideSiren] = useState("");
  const [doublon, setDoublon] = useState<ContactListe | null>(null);
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const champSiren = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusSiren) champSiren.current?.focus();
  }, [focusSiren]);

  const tva = tvaManuelle ?? tvaCalculee(siren) ?? "";
  const communes = optionsCommune(codePostal, commune);

  const appliquer = (recue: PropositionSiren) => {
    setProposition(recue);
    const champs = champsDepuisProposition(recue);
    if (champs.denomination !== "") setDenomination(champs.denomination);
    if (champs.forme !== "") setForme(champs.forme);
    if (champs.voie !== "") setVoie(champs.voie);
    if (champs.codePostal !== "") setCodePostal(champs.codePostal);
    if (champs.commune !== "") setCommune(champs.commune);
    if (champs.activite !== "") setActivite(champs.activite);
  };

  const chercher = () => {
    setMessage("");
    setDoublon(null);
    const erreur = controleSiren(siren);
    setAideSiren(erreur ?? "");
    if (erreur !== null) {
      setProposition(null);
      return;
    }
    const present = doublonSiren(siren, contacts);
    if (present !== null) {
      setProposition(null);
      setDoublon(present);
      return;
    }
    if (propositionFixe !== null) {
      appliquer(propositionFixe);
      return;
    }
    if (instanceUrl === undefined) {
      setMessage("La saisie manuelle reste possible.");
      return;
    }
    void (async () => {
      try {
        const json = await chercherSirenRegistre(instanceUrl, siren.replace(/\D/g, ""));
        const lue = propositionDepuisJson(json);
        if (lue === null) {
          setMessage("Le registre des entreprises est indisponible. La saisie manuelle reste possible.");
          return;
        }
        appliquer(lue);
      } catch (err) {
        setProposition(null);
        setMessage(err instanceof Error ? err.message : "Le registre des entreprises est indisponible.");
      }
    })();
  };

  const enregistrer = () => {
    setMessage("");
    const present = doublonSiren(siren, contacts);
    if (present !== null) {
      setDoublon(present);
      return;
    }
    let fiche;
    try {
      fiche = preparerCreation({
        siren,
        denomination,
        forme,
        activite,
        adresse: voie,
        codePostal,
        commune,
        tva,
        greffe,
        capitalEuros: capital,
        depuisRegistre: proposition !== null,
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Création impossible.");
      return;
    }
    const id = crypto.randomUUID();
    const contact = contactDepuisSociete(fiche, id);
    if (instanceUrl === undefined || propositionFixe !== null) {
      onCreee(contact);
      return;
    }
    setEnCours(true);
    void (async () => {
      try {
        await enregistrerContact(
          instanceUrl,
          id,
          corpsCreationSociete(fiche, id, crypto.randomUUID()),
          fiche.adresseSiege === null ? null : { usage: "siege", valeur: fiche.adresseSiege },
        );
        onCreee(contact);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "La fiche n'a pas été créée.");
        setEnCours(false);
      }
    })();
  };

  return (
    <div className="contacts-nc__form" data-testid="contacts-creation">
      <div>
        <div className="contacts-nc__siren">
          <label className="contacts-nc__champ">
            <span className="etiquette-champ">{fr("SIREN")}</span>
            <input
              ref={champSiren}
              className="champ"
              inputMode="numeric"
              placeholder={fr("9 chiffres")}
              data-testid="contacts-creation-siren"
              aria-invalid={aideSiren !== "" ? "true" : undefined}
              value={siren}
              onChange={(event) => {
                setSiren(event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="contacts-act"
            data-testid="contacts-creation-interroger"
            disabled={horsLigne || siren.trim() === ""}
            onClick={chercher}
          >
            <IconBuildingBank size={14} stroke={1.8} aria-hidden />
            {fr("Chercher dans le registre")}
          </button>
        </div>
        {aideSiren !== "" ? (
          <p className="contacts-nc__aide contacts-nc__aide--erreur" data-testid="contacts-creation-siren-erreur">
            {fr(aideSiren)}
          </p>
        ) : (
          <p className="contacts-nc__aide">
            {fr("Le registre propose la dénomination, la forme et l'adresse du siège.")}
          </p>
        )}
      </div>
      {horsLigne ? (
        <p className="message-attention">{fr("Hors ligne : la saisie manuelle reste possible.")}</p>
      ) : null}
      {doublon !== null ? (
        <div className="alerte" data-testid="contacts-creation-doublon">
          <IconGitMerge size={16} stroke={1.7} aria-hidden />
          <div>
            <b>{fr("Cette société est déjà dans l'annuaire :")}</b> {fr(libelleListeContact(doublon))}.
          </div>
          <button
            type="button"
            className="contacts-act"
            data-testid="contacts-creation-doublon-ouvrir"
            onClick={() => {
              onOuvrir(doublon.id);
            }}
          >
            {fr("Ouvrir la fiche")}
          </button>
        </div>
      ) : null}
      {proposition !== null ? (
        <div className="contacts-nc__prop" data-testid="contacts-creation-proposition">
          <IconBuildingBank size={16} stroke={1.8} aria-hidden />
          <div>
            {fr(
              "Proposé par le registre national des entreprises. Vérifiez chaque champ avant d'enregistrer ; le capital et le greffe ne sont pas publiés par ce registre.",
            )}
          </div>
        </div>
      ) : null}
      <div className="contacts-nc__g2">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Dénomination")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-denomination"
            value={denomination}
            onChange={(event) => {
              setDenomination(event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Forme")}</span>
          <select
            className="champ"
            data-testid="contacts-creation-forme"
            value={forme}
            onChange={(event) => {
              setForme(event.target.value);
            }}
          >
            <option value="">{fr("Non renseignée")}</option>
            {optionsForme(forme).map((option) => (
              <option key={option.code} value={option.code}>
                {fr(option.libelle)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="contacts-nc__g3">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Capital")}</span>
          <input
            className="champ"
            inputMode="numeric"
            placeholder={fr("En euros")}
            data-testid="contacts-creation-capital"
            value={capital}
            onChange={(event) => {
              setCapital(event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Greffe du RCS")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-greffe"
            value={greffe}
            onChange={(event) => {
              setGreffe(event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("N° TVA intracommunautaire")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-tva"
            value={tva}
            onChange={(event) => {
              setTvaManuelle(event.target.value);
            }}
          />
          <span className="contacts-nc__aide">{fr("Calculé à partir du SIREN")}</span>
        </label>
      </div>
      <label className="contacts-nc__champ">
        <span className="etiquette-champ">{fr("Adresse du siège")}</span>
        <input
          className="champ"
          data-testid="contacts-creation-adresse"
          value={voie}
          onChange={(event) => {
            setVoie(event.target.value);
          }}
        />
      </label>
      <div className="contacts-nc__cp">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Code postal")}</span>
          <input
            className="champ"
            inputMode="numeric"
            data-testid="contacts-creation-code-postal"
            value={codePostal}
            onChange={(event) => {
              setCodePostal(event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Commune")}</span>
          {communes.length > 0 ? (
            <select
              className="champ"
              data-testid="contacts-creation-commune"
              value={communeRetenue(codePostal, commune)}
              onChange={(event) => {
                setCommune(event.target.value);
              }}
            >
              {communes.map((nom) => (
                <option key={nom} value={nom}>
                  {fr(nom)}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="champ"
              data-testid="contacts-creation-commune"
              placeholder={fr(codePostal.trim().length === 5 ? "Commune à saisir" : "Proposée à partir du code postal")}
              value={commune}
              onChange={(event) => {
                setCommune(event.target.value);
              }}
            />
          )}
        </label>
      </div>
      {proposition !== null ? (
        <DirigeantsProposes dirigeants={proposition.dirigeants ?? []} contacts={contacts} onCreer={onDirigeantCree} />
      ) : null}
      {message !== "" ? (
        <p className="message-attention" role="alert" data-testid="contacts-creation-message">
          {fr(message)}
        </p>
      ) : null}
      <div className="contacts-nc__pied">
        <button
          type="button"
          className="bouton bouton--prim"
          data-testid="contacts-creation-creer"
          disabled={enCours}
          onClick={enregistrer}
        >
          {fr("Enregistrer la fiche")}
        </button>
        <button type="button" className="bouton bouton--discret" data-testid="contacts-creation-annuler" onClick={onAnnuler}>
          {fr("Annuler")}
        </button>
      </div>
    </div>
  );
}
