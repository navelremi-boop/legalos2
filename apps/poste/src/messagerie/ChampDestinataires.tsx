import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { fr } from "@/lib/fr";
import {
  ajouterDestinataires,
  etiquetteDestinataire,
  lireSaisie,
  retirerDestinataire,
  type ChampAdresses,
  type Destinataire,
} from "@/messagerie/adressesRedaction";
import {
  libelleSuggestion,
  provenanceSuggestion,
  SAISIE_MIN,
  toucheValideSaisie,
  type SuggestionDestinataire,
} from "@/messagerie/completion";
import { monogramme } from "@/messagerie/expediteurs";

type ChampDestinatairesProps = {
  champ: ChampAdresses;
  libelle: string;
  valeur: readonly Destinataire[];
  onChange: (valeur: Destinataire[]) => void;
  /** Suggestions pour une saisie (API, puis base locale hors ligne). */
  suggerer: (saisie: string) => Promise<SuggestionDestinataire[]>;
  /** À droite du champ : « Cc » et « Cci » pour faire apparaître les champs. */
  droite?: ReactNode;
  focusInitial?: boolean;
};

const DELAI_SUGGESTION_MS = 220;

/**
 * Champ d'adresses de la rédaction : puces, saisie, complétion. Entrée, Tab, virgule ou point-virgule valide ce
 * qui est écrit ; Retour arrière sur un champ vide retire la dernière puce ; les adresses collées (une liste)
 * deviennent plusieurs puces. Une saisie qui n'est pas une adresse n'est jamais ajoutée en silence.
 */
export function ChampDestinataires({
  champ,
  libelle,
  valeur,
  onChange,
  suggerer,
  droite,
  focusInitial = false,
}: ChampDestinatairesProps) {
  const identifiant = useId();
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestionDestinataire[]>([]);
  const [actif, setActif] = useState(-1);
  const [refus, setRefus] = useState<string | null>(null);
  const sequence = useRef(0);
  const dejaPresents = useRef(valeur);
  const entree = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dejaPresents.current = valeur;
  }, [valeur]);

  useEffect(() => {
    if (focusInitial) entree.current?.focus();
  }, [focusInitial]);

  useEffect(() => {
    if (Array.from(saisie.trim()).length < SAISIE_MIN) return;
    const numero = sequence.current + 1;
    sequence.current = numero;
    const minuterie = window.setTimeout(() => {
      void suggerer(saisie.trim()).then((trouvees) => {
        if (sequence.current !== numero) return;
        const presents = new Set(dejaPresents.current.map((d) => d.adresse.toLowerCase()));
        setSuggestions(trouvees.filter((s) => !presents.has(s.adresse.toLowerCase())));
        setActif(-1);
      });
    }, DELAI_SUGGESTION_MS);
    return () => {
      window.clearTimeout(minuterie);
    };
  }, [saisie, suggerer]);

  const visibles = Array.from(saisie.trim()).length >= SAISIE_MIN ? suggestions : [];
  const listeOuverte = visibles.length > 0;

  const ajouter = (nouveaux: readonly Destinataire[]) => {
    onChange(ajouterDestinataires(valeur, nouveaux));
    setSaisie("");
    setSuggestions([]);
    setActif(-1);
    setRefus(null);
  };

  /** Valide le texte écrit ; renvoie faux si une partie n'est pas une adresse (elle reste dans le champ). */
  const validerSaisie = (): boolean => {
    const texte = saisie.trim();
    if (texte === "") return true;
    const lecture = lireSaisie(texte);
    if (lecture.destinataires.length > 0) {
      onChange(ajouterDestinataires(valeur, lecture.destinataires));
    }
    if (lecture.invalides.length > 0) {
      setSaisie(lecture.invalides.join(", "));
      setRefus(`« ${lecture.invalides.join(", ")} » n'est pas une adresse valable.`);
      setSuggestions([]);
      return false;
    }
    setSaisie("");
    setSuggestions([]);
    setRefus(null);
    return true;
  };

  const changerSaisie = (texte: string) => {
    setRefus(null);
    // Une liste collée (virgules, points-virgules, retours à la ligne) devient plusieurs puces.
    if (/[,;\n]/u.test(texte) && /@/u.test(texte)) {
      const lecture = lireSaisie(texte);
      if (lecture.destinataires.length > 0) {
        onChange(ajouterDestinataires(valeur, lecture.destinataires));
        const reste = lecture.invalides.join(", ");
        setSaisie(reste);
        if (reste !== "") setRefus(`« ${reste} » n'est pas une adresse valable.`);
        setSuggestions([]);
        return;
      }
    }
    setSaisie(texte);
  };

  const identifiantListe = `${identifiant}-liste`;
  return (
    <div className="mails-redac__champ" data-testid={`champ-${champ}`}>
      <label htmlFor={`${identifiant}-saisie`}>{fr(libelle)}</label>
      <span className="mails-redac__puces">
        {valeur.map((destinataire) => (
          <span className="mails-redac__puce" key={destinataire.adresse} data-testid={`puce-${champ}`} data-adresse={destinataire.adresse}>
            <span className="mails-mono" aria-hidden>
              {monogramme({ nom: destinataire.nom, adresse: destinataire.adresse })}
            </span>
            {etiquetteDestinataire(destinataire)}
            <button
              type="button"
              className="mails-redac__retirer"
              aria-label={fr(`Retirer ${etiquetteDestinataire(destinataire)}`)}
              onClick={() => {
                onChange(retirerDestinataire(valeur, destinataire.adresse));
              }}
            >
              <IconX stroke={1.8} aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={`${identifiant}-saisie`}
          ref={entree}
          data-testid={`saisie-${champ}`}
          type="text"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={listeOuverte}
          aria-controls={identifiantListe}
          aria-autocomplete="list"
          aria-activedescendant={actif >= 0 ? `${identifiant}-s${String(actif)}` : undefined}
          placeholder={valeur.length === 0 ? fr("Nom, adresse ou contact") : undefined}
          value={saisie}
          onChange={(event) => {
            changerSaisie(event.target.value);
          }}
          onBlur={() => {
            if (saisie.trim() !== "" && lireSaisie(saisie).invalides.length === 0) validerSaisie();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && listeOuverte) {
              event.preventDefault();
              setActif((courant) => (courant + 1) % visibles.length);
              return;
            }
            if (event.key === "ArrowUp" && listeOuverte) {
              event.preventDefault();
              setActif((courant) => (courant <= 0 ? visibles.length - 1 : courant - 1));
              return;
            }
            if (event.key === "Escape" && listeOuverte) {
              event.preventDefault();
              setSuggestions([]);
              return;
            }
            if (event.key === "Backspace" && saisie === "" && valeur.length > 0) {
              const derniere = valeur[valeur.length - 1];
              if (derniere !== undefined) onChange(retirerDestinataire(valeur, derniere.adresse));
              return;
            }
            if ((event.key === "Enter" || event.key === "Tab") && listeOuverte) {
              // Sans suggestion surlignée, un nom qui n'est pas une adresse prend la première suggestion.
              const choisie =
                actif >= 0
                  ? visibles[actif]
                  : lireSaisie(saisie).destinataires.length === 0
                    ? visibles[0]
                    : undefined;
              if (choisie !== undefined) {
                event.preventDefault();
                ajouter([{ adresse: choisie.adresse, nom: choisie.nom }]);
                return;
              }
            }
            if (toucheValideSaisie(event.key, saisie)) {
              event.preventDefault();
              validerSaisie();
            }
          }}
        />
        {listeOuverte ? (
          <ul className="mails-redac__suggestions" id={identifiantListe} role="listbox" data-testid={`suggestions-${champ}`}>
            {visibles.map((suggestion, index) => (
              <li
                key={suggestion.adresse}
                id={`${identifiant}-s${String(index)}`}
                role="option"
                aria-selected={index === actif}
                data-testid={`suggestion-${champ}`}
                data-adresse={suggestion.adresse}
                onMouseDown={(event) => {
                  event.preventDefault();
                  ajouter([{ adresse: suggestion.adresse, nom: suggestion.nom }]);
                }}
              >
                <span>{libelleSuggestion(suggestion)}</span>
                <small>{fr(provenanceSuggestion(suggestion.source))}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </span>
      <span className="mails-redac__droite">{droite}</span>
      {refus !== null ? (
        <p className="mails-erreur mails-redac__refus" role="alert" data-testid={`refus-${champ}`}>
          {fr(refus)}
        </p>
      ) : null}
    </div>
  );
}
