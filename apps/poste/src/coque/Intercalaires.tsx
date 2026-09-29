import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { fr } from "@/lib/fr";

export type IntercalaireStandardId =
  | "chrono"
  | "procedure"
  | "pieces"
  | "mails"
  | "factures";

/** Identifiant d’onglet : standard ou UUID d’intercalaire personnalisé. */
export type IntercalaireId = IntercalaireStandardId | (string & {});

export type IntercalaireItem = {
  id: IntercalaireId;
  label: string;
  compteur?: number;
  /** Présent uniquement pour les intercalaires créés par l’utilisateur. */
  personnalise?: boolean;
};

export const INTERCALAIRES_STANDARDS: IntercalaireItem[] = [
  { id: "chrono", label: "Chrono", compteur: 0 },
  { id: "procedure", label: "Procédure", compteur: 0 },
  { id: "pieces", label: "Pièces", compteur: 0 },
  { id: "mails", label: "Mails", compteur: 0 },
  { id: "factures", label: "Factures", compteur: 0 },
];

export function estIntercalaireStandard(id: IntercalaireId): id is IntercalaireStandardId {
  return INTERCALAIRES_STANDARDS.some((item) => item.id === id);
}

type IntercalairesProps = {
  items?: IntercalaireItem[];
  actif: IntercalaireId;
  onChanger: (id: IntercalaireId) => void;
  /** Création d’un intercalaire personnalisé (nom déjà trimé). */
  onCreer?: (nom: string) => void | Promise<void>;
  /** Retrait d’un intercalaire personnalisé seulement. */
  onRetirer?: (id: IntercalaireId) => void | Promise<void>;
};

export function Intercalaires({
  items = INTERCALAIRES_STANDARDS,
  actif,
  onChanger,
  onCreer,
  onRetirer,
}: IntercalairesProps) {
  const [saisieOuverte, setSaisieOuverte] = useState(false);
  const [nom, setNom] = useState("");
  const [enCours, setEnCours] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const saisieId = useId();

  useEffect(() => {
    if (saisieOuverte) {
      inputRef.current?.focus();
    }
  }, [saisieOuverte]);

  const valider = async (ok: boolean) => {
    if (!saisieOuverte || enCours) return;
    const valeur = nom.trim();
    setSaisieOuverte(false);
    setNom("");
    if (!ok || valeur === "" || !onCreer) return;
    setEnCours(true);
    try {
      await onCreer(valeur);
    } finally {
      setEnCours(false);
    }
  };

  const onTouche = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void valider(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      void valider(false);
    }
  };

  return (
    <div className="intercalaires" data-testid="intercalaires" role="tablist" aria-label={fr("Intercalaires")}>
      {items.map((item) => {
        const estActif = item.id === actif;
        const perso = item.personnalise === true;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={estActif}
            data-testid={perso ? `intercalaire-perso-${item.id}` : `intercalaire-${item.id}`}
            data-perso={perso ? "1" : undefined}
            className={[
              "intercalaire",
              estActif ? "intercalaire--actif" : "",
              perso ? "intercalaire--perso" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              onChanger(item.id);
            }}
          >
            <span className="intercalaire__libelle">{fr(item.label)}</span>
            {item.compteur !== undefined ? (
              <em className="intercalaire__compteur">{item.compteur}</em>
            ) : null}
            {perso && onRetirer ? (
              <span
                role="button"
                tabIndex={0}
                className="intercalaire__supprimer"
                data-testid={`intercalaire-retirer-${item.id}`}
                title={fr("Retirer l'intercalaire")}
                aria-label={fr("Retirer l'intercalaire")}
                onClick={(event) => {
                  event.stopPropagation();
                  void onRetirer(item.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    void onRetirer(item.id);
                  }
                }}
              >
                ×
              </span>
            ) : null}
          </button>
        );
      })}
      {onCreer ? (
        saisieOuverte ? (
          <input
            ref={inputRef}
            id={saisieId}
            className="intercalaire-saisie"
            data-testid="intercalaire-saisie"
            maxLength={24}
            placeholder={fr("Nom de l'intercalaire")}
            aria-label={fr("Nom du nouvel intercalaire")}
            value={nom}
            disabled={enCours}
            onChange={(event) => {
              setNom(event.target.value);
            }}
            onKeyDown={onTouche}
            onBlur={() => {
              void valider(true);
            }}
          />
        ) : (
          <button
            type="button"
            className="intercalaire-ajout"
            data-testid="intercalaire-ajout"
            disabled={enCours}
            onClick={() => {
              setSaisieOuverte(true);
            }}
          >
            {fr("+ Intercalaire")}
          </button>
        )
      ) : null}
    </div>
  );
}
