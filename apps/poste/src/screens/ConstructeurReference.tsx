import {
  estBlocSeparateur,
  texteDepuisBlocs,
  type Bloc,
} from "@/lib/modeleReference";
import { fr } from "@/lib/fr";

const SEPARATEURS = [
  { valeur: "", libelle: "Aucun" },
  { valeur: "/", libelle: "/" },
  { valeur: "-", libelle: "-" },
  { valeur: ".", libelle: "." },
  { valeur: "_", libelle: "_" },
  { valeur: " ", libelle: "Espace" },
] as const;

const champ =
  "rounded-[var(--radius-control)] border border-filet bg-feuille-2 px-2 py-1 text-encre";

type ConstructeurReferenceProps = {
  blocs: readonly Bloc[];
  onChange: (modele: string) => void;
};

function remplacer(blocs: readonly Bloc[], index: number, bloc: Bloc): Bloc[] {
  return blocs.map((actuel, i) => (i === index ? bloc : actuel));
}

export function ConstructeurReference({ blocs, onChange }: ConstructeurReferenceProps) {
  function appliquer(suivants: readonly Bloc[]) {
    onChange(texteDepuisBlocs(suivants));
  }

  function ajouter(nouveau: Bloc) {
    const suivants = [...blocs];
    const dernier = suivants[suivants.length - 1];
    if (dernier !== undefined && !estBlocSeparateur(dernier) && !estBlocSeparateur(nouveau)) {
      suivants.push({ kind: "texte", valeur: "" });
    }
    suivants.push(nouveau);
    appliquer(suivants);
  }

  return (
    <div data-testid="reglages-reference-constructeur" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {blocs.map((bloc, index) => {
          if (estBlocSeparateur(bloc) && bloc.kind === "texte") {
            return (
              <label key={`sep-${String(index)}`} className="text-[length:var(--font-size-dense)] text-graphite">
                <span className="sr-only">{fr("Séparateur")}</span>
                <select
                  className={champ}
                  data-testid="reglages-reference-separateur"
                  value={bloc.valeur}
                  onChange={(event) => {
                    appliquer(remplacer(blocs, index, { kind: "texte", valeur: event.target.value }));
                  }}
                >
                  {SEPARATEURS.map((sep) => (
                    <option key={sep.libelle} value={sep.valeur}>
                      {fr(sep.libelle)}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (bloc.kind === "annee") {
            return (
              <label key={`annee-${String(index)}`} className="text-[length:var(--font-size-dense)] text-graphite">
                {fr("Année")}
                <select
                  className={`ml-1 ${champ}`}
                  data-testid="reglages-reference-bloc"
                  data-kind="annee"
                  value={String(bloc.chiffres)}
                  onChange={(event) => {
                    appliquer(
                      remplacer(blocs, index, {
                        kind: "annee",
                        chiffres: event.target.value === "2" ? 2 : 4,
                      }),
                    );
                  }}
                >
                  <option value="4">{fr("4 chiffres")}</option>
                  <option value="2">{fr("2 chiffres")}</option>
                </select>
              </label>
            );
          }
          if (bloc.kind === "numero") {
            return (
              <label key={`numero-${String(index)}`} className="text-[length:var(--font-size-dense)] text-graphite">
                {fr("Numéro")}
                <select
                  className={`ml-1 ${champ}`}
                  data-testid="reglages-reference-bloc"
                  data-kind="numero"
                  value={bloc.chiffres === null ? "libre" : String(bloc.chiffres)}
                  onChange={(event) => {
                    const choisi = event.target.value;
                    appliquer(
                      remplacer(blocs, index, {
                        kind: "numero",
                        chiffres: choisi === "libre" ? null : Number(choisi),
                      }),
                    );
                  }}
                >
                  <option value="libre">{fr("Sans complément")}</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => (
                    <option key={k} value={String(k)}>
                      {fr(`${String(k)} chiffres`)}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (bloc.kind === "initiales") {
            return (
              <span
                key={`ini-${String(index)}`}
                className={`${champ} inline-flex items-center gap-2`}
                data-testid="reglages-reference-bloc"
                data-kind="initiales"
              >
                {fr("Initiales")}
                <button
                  type="button"
                  className="text-[length:var(--font-size-dense)] text-graphite"
                  onClick={() => {
                    appliquer(blocs.filter((_, i) => i !== index));
                  }}
                >
                  {fr("Retirer")}
                </button>
              </span>
            );
          }
          return (
            <label key={`texte-${String(index)}`} className="text-[length:var(--font-size-dense)] text-graphite">
              {fr("Texte")}
              <input
                className={`ml-1 ${champ}`}
                data-testid="reglages-reference-bloc"
                data-kind="texte"
                value={bloc.valeur}
                onChange={(event) => {
                  appliquer(remplacer(blocs, index, { kind: "texte", valeur: event.target.value }));
                }}
              />
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {blocs.every((bloc) => bloc.kind !== "annee") ? (
          <button
            type="button"
            className={champ}
            onClick={() => {
              ajouter({ kind: "annee", chiffres: 4 });
            }}
          >
            {fr("Ajouter l’année")}
          </button>
        ) : null}
        {blocs.every((bloc) => bloc.kind !== "numero") ? (
          <button
            type="button"
            className={champ}
            onClick={() => {
              ajouter({ kind: "numero", chiffres: 3 });
            }}
          >
            {fr("Ajouter le numéro")}
          </button>
        ) : null}
        {blocs.every((bloc) => bloc.kind !== "initiales") ? (
          <button
            type="button"
            className={champ}
            onClick={() => {
              ajouter({ kind: "initiales" });
            }}
          >
            {fr("Ajouter les initiales")}
          </button>
        ) : null}
        <button
          type="button"
          className={champ}
          onClick={() => {
            ajouter({ kind: "texte", valeur: "texte" });
          }}
        >
          {fr("Ajouter un texte")}
        </button>
      </div>
    </div>
  );
}
