import { useId, useState } from "react";
import { filtrerDossiers, type DossierChoix } from "@/dossiers/rechercheDossier";
import { fr } from "@/lib/fr";
import { libelleReferenceDossier } from "@/lib/referenceDossier";

type ChoixDossierProps = {
  /** Identifiant du contrôle porteur de la valeur (select ou champ), lu par le formulaire et les recettes. */
  id: string;
  name: string;
  testId: string;
  dossiers: DossierChoix[];
  valeur: string;
  onChange: (id: string) => void;
  required?: boolean;
  /** « liste » : la valeur vit dans un select ; « champ » : dans un champ texte. */
  support?: "liste" | "champ";
  placeholder?: string;
  libelle?: string;
};

/**
 * Choix d'un dossier par recherche (nom ou référence), jamais par identifiant.
 * Le contrôle porteur reste dans le formulaire, masqué à l'écran.
 */
export function ChoixDossier({
  id,
  name,
  testId,
  dossiers,
  valeur,
  onChange,
  required = false,
  support = "liste",
  placeholder = "Rechercher un dossier par nom ou référence",
  libelle = "Dossier",
}: ChoixDossierProps) {
  const liste = useId();
  const [saisie, setSaisie] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const choisi = dossiers.find((dossier) => dossier.id === valeur) ?? null;
  const affiche = saisie ?? (choisi ? choisi.nom : "");
  const resultats = filtrerDossiers(dossiers, saisie ?? "");

  function choisir(dossier: DossierChoix) {
    onChange(dossier.id);
    setSaisie(null);
    setOuvert(false);
  }

  return (
    <div className="choix-dossier">
      <input
        id={`${id}-recherche`}
        className="champ"
        role="combobox"
        aria-label={fr(libelle)}
        aria-expanded={ouvert}
        aria-controls={liste}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={fr(placeholder)}
        value={affiche}
        onFocus={() => {
          setOuvert(true);
        }}
        onBlur={() => {
          setOuvert(false);
          setSaisie(null);
        }}
        onChange={(event) => {
          setSaisie(event.target.value);
          setActif(0);
          setOuvert(true);
          if (event.target.value === "") onChange("");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOuvert(true);
            setActif((index) => Math.min(index + 1, resultats.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActif((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && ouvert) {
            const cible = resultats[actif];
            if (cible) {
              event.preventDefault();
              choisir(cible);
            }
          } else if (event.key === "Escape") {
            setOuvert(false);
            setSaisie(null);
          }
        }}
      />
      {ouvert ? (
        <ul className="choix-dossier__liste choix-dossier__liste--flottante" id={liste} role="listbox">
          {resultats.length === 0 ? (
            <li className="choix-dossier__vide" role="presentation">
              {fr("Aucun dossier ne correspond.")}
            </li>
          ) : (
            resultats.map((dossier, index) => (
              <li key={dossier.id} role="presentation">
                <button
                  type="button"
                  className="choix-dossier__option"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === actif}
                  data-chemise={dossier.chemise ?? undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choisir(dossier);
                  }}
                >
                  {dossier.reference ? (
                    <span className="chiffres-reference choix-dossier__ref">
                      {fr(libelleReferenceDossier(dossier.reference))}
                    </span>
                  ) : null}
                  <span className="truncate">{fr(dossier.nom)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {support === "liste" ? (
        <select
          id={id}
          name={name}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          required={required}
          data-testid={testId}
          value={valeur}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{fr("Choisir un dossier")}</option>
          {dossiers.map((dossier) => (
            <option key={dossier.id} value={dossier.id}>
              {dossier.nom}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={name}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          required={required}
          data-testid={testId}
          value={valeur}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </div>
  );
}
