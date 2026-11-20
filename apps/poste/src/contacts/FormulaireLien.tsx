import { useId, useState } from "react";
import { candidatsLien } from "@/contacts/candidatsLien";
import {
  champsModifies,
  controlerLien,
  FONCTIONS_MANDAT,
  saisieDepuisLien,
  saisieLienVide,
  TYPES_LIEN_SAISIS,
  type ChampLien,
  type ChampsLienModifies,
  type SaisieLien,
} from "@/contacts/controleLien";
import type { LienAEcrire } from "@/contacts/ecrireLien";
import type { LienAffiche } from "@/contacts/liensContacts";
import { libelleListeContact, nomCourtContact, type ContactListe } from "@/contacts/listeContacts";
import { fr } from "@/lib/fr";

type Erreurs = Partial<Record<ChampLien, string>>;

function messageDe(erreur: unknown, defaut: string): string {
  return erreur instanceof Error && erreur.message !== "" ? erreur.message : defaut;
}

type FormulaireLienProps = {
  sourceId: string;
  contacts: readonly ContactListe[];
  liens: readonly LienAffiche[];
  /** Écrit le lien (écriture locale synchronisée). Lève une erreur au message lisible si l'écriture échoue. */
  onAjouter: (lien: LienAEcrire) => Promise<void>;
  onFermer: () => void;
};

/**
 * « Ajouter un lien » d'après la maquette : type, fonction, « Avec » (recherche dans l'annuaire), début, fin,
 * source, et « Représente la société » pour un mandat social. Les contrôles sont dans `controleLien.ts` ; l'écriture
 * est locale, hors ligne comprise, et l'API les refait à l'envoi.
 */
export function FormulaireLien({ sourceId, contacts, liens, onAjouter, onFermer }: FormulaireLienProps) {
  const [saisie, setSaisie] = useState<SaisieLien>(saisieLienVide);
  const [recherche, setRecherche] = useState("");
  const [cible, setCible] = useState<ContactListe | null>(null);
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const idListe = useId();
  const propositions = cible === null ? candidatsLien(contacts, sourceId, recherche) : [];
  const mandat = saisie.typeLien === "mandat_social";

  const poser = <K extends keyof SaisieLien>(champ: K, valeur: SaisieLien[K]) => {
    setSaisie((etat) => ({ ...etat, [champ]: valeur }));
    setMessage("");
  };

  const enregistrer = () => {
    if (enCours) return;
    const controle = controlerLien(saisie, {
      sourceId,
      cible: cible === null ? null : { id: cible.id, nature: cible.nature },
      liensExistants: liens,
      lienId: null,
    });
    if (!controle.ok) {
      setErreurs(controle.erreurs);
      setMessage(controle.message);
      return;
    }
    if (cible === null) return;
    setErreurs({});
    setEnCours(true);
    void onAjouter({ ...controle.lien, sourceId, cibleId: cible.id }).then(
      () => {
        setEnCours(false);
        onFermer();
      },
      (erreur: unknown) => {
        setEnCours(false);
        setMessage(messageDe(erreur, "Le lien n'a pas été enregistré."));
      },
    );
  };

  return (
    <div
      className="contacts-lien-form"
      data-testid="contacts-lien-formulaire"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onFermer();
        }
      }}
    >
      <div className="contacts-nc__g3">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Type de lien")}</span>
          <select
            className="champ"
            data-testid="contacts-lien-type"
            aria-invalid={erreurs.typeLien !== undefined}
            value={saisie.typeLien}
            onChange={(event) => {
              poser("typeLien", event.target.value);
            }}
          >
            {TYPES_LIEN_SAISIS.map((type) => (
              <option key={type.code} value={type.code}>
                {fr(type.libelle)}
              </option>
            ))}
          </select>
        </label>
        {mandat ? (
          <label className="contacts-nc__champ">
            <span className="etiquette-champ">{fr("Fonction")}</span>
            <select
              className="champ"
              data-testid="contacts-lien-fonction"
              aria-invalid={erreurs.fonction !== undefined}
              value={saisie.fonction}
              onChange={(event) => {
                poser("fonction", event.target.value);
              }}
            >
              {FONCTIONS_MANDAT.map((fonction) => (
                <option key={fonction.code} value={fonction.code}>
                  {fr(fonction.libelle)}
                </option>
              ))}
            </select>
          </label>
        ) : saisie.typeLien === "autre" ? (
          <label className="contacts-nc__champ">
            <span className="etiquette-champ">{fr("Libellé du lien")}</span>
            <input
              className="champ"
              data-testid="contacts-lien-libelle"
              autoComplete="off"
              aria-invalid={erreurs.libelle !== undefined}
              value={saisie.libelle}
              onChange={(event) => {
                poser("libelle", event.target.value);
              }}
            />
          </label>
        ) : (
          <div />
        )}
        <div className="contacts-nc__champ contacts-lien-form__avec">
          <label className="etiquette-champ" htmlFor={`${idListe}-avec`}>
            {fr("Avec")}
          </label>
          <input
            id={`${idListe}-avec`}
            type="search"
            className="champ"
            data-testid="contacts-lien-avec"
            placeholder={fr("Chercher un contact")}
            autoComplete="off"
            role="combobox"
            aria-expanded={propositions.length > 0}
            aria-controls={idListe}
            aria-invalid={erreurs.cible !== undefined}
            value={cible === null ? recherche : libelleListeContact(cible)}
            onChange={(event) => {
              setCible(null);
              setRecherche(event.target.value);
              setMessage("");
            }}
          />
          {propositions.length > 0 ? (
            <ul id={idListe} className="contacts-lien-form__choix" role="listbox" data-testid="contacts-lien-candidats">
              {propositions.map((contact) => (
                <li key={contact.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    data-testid="contacts-lien-candidat"
                    data-contact-id={contact.id}
                    onClick={() => {
                      setCible(contact);
                      setRecherche("");
                      setErreurs((etat) => ({ ...etat, cible: undefined }));
                    }}
                  >
                    {fr(nomCourtContact(contact))}
                    <small>{fr(contact.nature === "morale" ? "Personne morale" : "Personne physique")}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="contacts-nc__g3">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Depuis le")}</span>
          <input
            type="date"
            className="champ"
            data-testid="contacts-lien-debut"
            aria-invalid={erreurs.debut !== undefined}
            value={saisie.debut}
            onChange={(event) => {
              poser("debut", event.target.value);
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Jusqu'au")}</span>
          <input
            type="date"
            className="champ"
            data-testid="contacts-lien-fin"
            aria-invalid={erreurs.fin !== undefined}
            value={saisie.fin}
            onChange={(event) => {
              poser("fin", event.target.value);
            }}
          />
          <span className="contacts-nc__aide">{fr("Vide si le lien est en cours")}</span>
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Source")}</span>
          <input
            className="champ"
            data-testid="contacts-lien-source"
            placeholder={fr("Kbis, statuts, procès-verbal…")}
            autoComplete="off"
            value={saisie.source}
            onChange={(event) => {
              poser("source", event.target.value);
            }}
          />
        </label>
      </div>
      {mandat ? (
        <label className="contacts-lien-form__case">
          <input
            type="checkbox"
            data-testid="contacts-lien-represente"
            checked={saisie.representeSociete}
            onChange={(event) => {
              poser("representeSociete", event.target.checked);
            }}
          />
          {fr("Représente la société")}
        </label>
      ) : null}
      {message !== "" ? (
        <p className="message-attention" role="alert" data-testid="contacts-lien-message">
          {fr(message)}
        </p>
      ) : null}
      <div className="contacts-nc__pied">
        <button
          type="button"
          className="bouton bouton--prim"
          data-testid="contacts-lien-enregistrer"
          disabled={enCours}
          onClick={enregistrer}
        >
          {fr("Enregistrer le lien")}
        </button>
        <button type="button" className="bouton bouton--discret" data-testid="contacts-lien-annuler" onClick={onFermer}>
          {fr("Annuler")}
        </button>
      </div>
    </div>
  );
}

type FormulaireModificationLienProps = {
  lien: LienAffiche;
  /** Libellé du lien tel que la liste l'affiche (« Gérant de SAS Duclos »). */
  titre: string;
  cibleNature: "physique" | "morale";
  liens: readonly LienAffiche[];
  onModifier: (id: string, champs: ChampsLienModifies) => Promise<void>;
  onFermer: () => void;
};

/**
 * « Modifier » un lien : poser une date de fin (ou corriger le début et la source). Le type, la fonction et la
 * cible ne changent pas : un autre lien se crée. Mêmes contrôles que la création.
 */
export function FormulaireModificationLien({
  lien,
  titre,
  cibleNature,
  liens,
  onModifier,
  onFermer,
}: FormulaireModificationLienProps) {
  const [saisie, setSaisie] = useState<SaisieLien>(() => saisieDepuisLien(lien));
  const [erreurs, setErreurs] = useState<Erreurs>({});
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);

  const enregistrer = () => {
    if (enCours) return;
    const controle = controlerLien(saisie, {
      sourceId: lien.sourceId,
      cible: { id: lien.cibleId, nature: cibleNature },
      liensExistants: liens,
      lienId: lien.id,
    });
    if (!controle.ok) {
      setErreurs(controle.erreurs);
      setMessage(controle.message);
      return;
    }
    const champs = champsModifies(lien, saisie);
    if (Object.keys(champs).length === 0) {
      onFermer();
      return;
    }
    setErreurs({});
    setEnCours(true);
    void onModifier(lien.id, champs).then(
      () => {
        setEnCours(false);
        onFermer();
      },
      (erreur: unknown) => {
        setEnCours(false);
        setMessage(messageDe(erreur, "Le lien n'a pas été modifié."));
      },
    );
  };

  return (
    <div
      className="contacts-lien-form"
      data-testid="contacts-lien-edition"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onFermer();
        }
      }}
    >
      <p className="contacts-lien-form__titre">{fr(titre)}</p>
      <div className="contacts-nc__g3">
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Depuis le")}</span>
          <input
            type="date"
            className="champ"
            data-testid="contacts-lien-edition-debut"
            aria-invalid={erreurs.debut !== undefined}
            value={saisie.debut}
            onChange={(event) => {
              setSaisie((etat) => ({ ...etat, debut: event.target.value }));
              setMessage("");
            }}
          />
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Jusqu'au")}</span>
          <input
            type="date"
            className="champ"
            data-testid="contacts-lien-edition-fin"
            aria-invalid={erreurs.fin !== undefined}
            value={saisie.fin}
            onChange={(event) => {
              setSaisie((etat) => ({ ...etat, fin: event.target.value }));
              setMessage("");
            }}
          />
          <span className="contacts-nc__aide">{fr("Vide si le lien est en cours")}</span>
        </label>
        <label className="contacts-nc__champ">
          <span className="etiquette-champ">{fr("Source")}</span>
          <input
            className="champ"
            data-testid="contacts-lien-edition-source"
            autoComplete="off"
            value={saisie.source}
            onChange={(event) => {
              setSaisie((etat) => ({ ...etat, source: event.target.value }));
              setMessage("");
            }}
          />
        </label>
      </div>
      {message !== "" ? (
        <p className="message-attention" role="alert" data-testid="contacts-lien-edition-message">
          {fr(message)}
        </p>
      ) : null}
      <div className="contacts-nc__pied">
        <button
          type="button"
          className="bouton bouton--prim"
          data-testid="contacts-lien-edition-enregistrer"
          disabled={enCours}
          onClick={enregistrer}
        >
          {fr("Enregistrer")}
        </button>
        <button type="button" className="bouton bouton--discret" data-testid="contacts-lien-edition-annuler" onClick={onFermer}>
          {fr("Annuler")}
        </button>
      </div>
    </div>
  );
}
