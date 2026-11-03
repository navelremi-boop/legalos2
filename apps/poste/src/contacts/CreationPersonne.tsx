import { useState } from "react";
import { communeRetenue, optionsCommune, professionsCreation } from "@/contacts/creationContact";
import {
  contactDepuisPersonne,
  corpsCreationPersonne,
  preparerCreationPersonne,
  type SaisiePersonne,
} from "@/contacts/creerPersonne";
import { enregistrerContact } from "@/contacts/enregistrerContact";
import { accordDemande, optionsCivilite } from "@/contacts/identiteFiche";
import type { ContactListe } from "@/contacts/listeContacts";
import { fr } from "@/lib/fr";

type CreationPersonneProps = {
  instanceUrl?: string;
  /** Galerie : la fiche reste locale. */
  local?: boolean;
  onCreee: (contact: ContactListe) => void;
  onAnnuler: () => void;
};

const SAISIE_VIDE: SaisiePersonne = {
  civilite: "",
  accord: "",
  prenoms: "",
  nom: "",
  nomNaissance: "",
  dateNaissance: "",
  lieuNaissance: "",
  nationalite: "Française",
  profession: "",
  professionReglementee: "",
  voie: "",
  codePostal: "",
  commune: "",
};

/** Formulaire de création d'une personne physique, d'après le rendu de création de la maquette. */
export function CreationPersonne({ instanceUrl, local = false, onCreee, onAnnuler }: CreationPersonneProps) {
  const [saisie, setSaisie] = useState<SaisiePersonne>(SAISIE_VIDE);
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);

  const poser = (champ: keyof SaisiePersonne, valeur: string) => {
    setSaisie((etat) => ({ ...etat, [champ]: valeur }));
  };
  const communes = optionsCommune(saisie.codePostal, saisie.commune);

  const enregistrer = () => {
    setMessage("");
    let fiche;
    try {
      fiche = preparerCreationPersonne(saisie);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Création impossible.");
      return;
    }
    const id = crypto.randomUUID();
    const contact = contactDepuisPersonne(fiche, id);
    if (instanceUrl === undefined || local) {
      onCreee(contact);
      return;
    }
    setEnCours(true);
    void (async () => {
      try {
        await enregistrerContact(
          instanceUrl,
          id,
          corpsCreationPersonne(fiche, id, crypto.randomUUID()),
          fiche.adresseDomicile === null ? null : { usage: "domicile", valeur: fiche.adresseDomicile },
        );
        onCreee(contact);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "La fiche n'a pas été créée.");
        setEnCours(false);
      }
    })();
  };

  return (
    <div className="contacts-nc__form" data-testid="contacts-creation-personne">
      <div className="contacts-nc__g3">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Civilité")}</span>
          <select
            className="champ"
            data-testid="contacts-creation-civilite"
            value={saisie.civilite}
            onChange={(event) => {
              poser("civilite", event.target.value);
            }}
          >
            <option value="">{fr("Non renseignée")}</option>
            {optionsCivilite(saisie.civilite === "" ? null : saisie.civilite).map((libelle) => (
              <option key={libelle} value={libelle}>
                {fr(libelle)}
              </option>
            ))}
          </select>
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Prénoms")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-prenoms"
            value={saisie.prenoms}
            onChange={(event) => {
              poser("prenoms", event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Nom")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-nom"
            value={saisie.nom}
            onChange={(event) => {
              poser("nom", event.target.value);
            }}
          />
        </label>
      </div>
      {accordDemande(saisie.civilite === "" ? null : saisie.civilite) ? (
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Accord")}</span>
          <select
            className="champ"
            data-testid="contacts-creation-accord"
            value={saisie.accord}
            onChange={(event) => {
              poser("accord", event.target.value);
            }}
          >
            <option value="">{fr("Non renseigné")}</option>
            <option value="feminin">{fr("Féminin")}</option>
            <option value="masculin">{fr("Masculin")}</option>
          </select>
        </label>
      ) : null}
      <div className="contacts-nc__g3">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Nom de naissance")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-nom-naissance"
            value={saisie.nomNaissance}
            onChange={(event) => {
              poser("nomNaissance", event.target.value);
            }}
          />
          <span className="contacts-nc__aide">{fr("Si différent du nom")}</span>
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Date de naissance")}</span>
          <input
            className="champ"
            type="date"
            data-testid="contacts-creation-date-naissance"
            value={saisie.dateNaissance}
            onChange={(event) => {
              poser("dateNaissance", event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Lieu de naissance")}</span>
          <input
            className="champ"
            placeholder={fr("Commune et département")}
            data-testid="contacts-creation-lieu-naissance"
            value={saisie.lieuNaissance}
            onChange={(event) => {
              poser("lieuNaissance", event.target.value);
            }}
          />
        </label>
      </div>
      <div className="contacts-nc__g3">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Nationalité")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-nationalite"
            value={saisie.nationalite}
            onChange={(event) => {
              poser("nationalite", event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Profession")}</span>
          <input
            className="champ"
            data-testid="contacts-creation-profession"
            value={saisie.profession}
            onChange={(event) => {
              poser("profession", event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Profession réglementée")}</span>
          <select
            className="champ"
            data-testid="contacts-creation-profession-reglementee"
            value={saisie.professionReglementee}
            onChange={(event) => {
              poser("professionReglementee", event.target.value);
            }}
          >
            <option value="">{fr("Aucune")}</option>
            {professionsCreation().map((profession) => (
              <option key={profession.code} value={profession.code}>
                {fr(profession.libelle)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="contacts-nc__champ">
        <span className="etiquette-champ">{fr("Adresse du domicile")}</span>
        <input
          className="champ"
          placeholder={fr("Numéro et voie")}
          data-testid="contacts-creation-adresse"
          value={saisie.voie}
          onChange={(event) => {
            poser("voie", event.target.value);
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
            value={saisie.codePostal}
            onChange={(event) => {
              poser("codePostal", event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Commune")}</span>
          {communes.length > 0 ? (
            <select
              className="champ"
              data-testid="contacts-creation-commune"
              value={communeRetenue(saisie.codePostal, saisie.commune)}
              onChange={(event) => {
                poser("commune", event.target.value);
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
              placeholder={fr(
                saisie.codePostal.trim().length === 5 ? "Commune à saisir" : "Proposée à partir du code postal",
              )}
              value={saisie.commune}
              onChange={(event) => {
                poser("commune", event.target.value);
              }}
            />
          )}
        </label>
      </div>
      {message !== "" ? (
        <p className="message-attention" role="alert" data-testid="contacts-creation-personne-erreur">
          {fr(message)}
        </p>
      ) : null}
      <div className="contacts-nc__pied">
        <button
          type="button"
          className="bouton bouton--prim"
          data-testid="contacts-creation-personne-creer"
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
