import { useMemo, useState } from "react";
import { fr } from "@/lib/fr";
import { ApercuChrono } from "./ApercuChrono";
import { BadgeDefinitif } from "./BadgeDefinitif";
import { FILTRE_LIBELLES, PERIODE_LIBELLES } from "./libelles";
import { IconeTypeChrono } from "./icones";
import type { ChronoFiltre, ChronoItem, ChronoPeriode } from "./types";

const PERIODES: ChronoPeriode[] = ["aujourdhui", "cette-semaine", "plus-tot"];
const FILTRES: ChronoFiltre[] = ["tout", "mails", "pieces", "factures"];

function filtreCorrespond(item: ChronoItem, filtre: ChronoFiltre): boolean {
  switch (filtre) {
    case "tout":
      return true;
    case "mails":
      return item.type === "mail";
    case "pieces":
      return item.type === "piece";
    case "factures":
      return item.type === "facture";
    default: {
      const _exhaustive: never = filtre;
      return _exhaustive;
    }
  }
}

type VueScindeeProps = {
  /** Éléments synchronisés. Vide tant que le branchement mail / pièces / factures n’est pas fait. */
  items?: ChronoItem[];
};

/**
 * Vue scindée de l’intercalaire Chrono (§ 7.4) : liste groupée + aperçu.
 * Sans élément : état vide. Le jeu fictif n’est pas le défaut (galerie seulement).
 */
export function VueScindee({ items = [] }: VueScindeeProps) {
  const [filtre, setFiltre] = useState<ChronoFiltre>("tout");
  const [selectionId, setSelectionId] = useState(items[0]?.id ?? "");
  const filtrés = useMemo(
    () => items.filter((item) => filtreCorrespond(item, filtre)),
    [items, filtre],
  );

  if (items.length === 0) {
    return (
      <div className="chrono-vide px-[22px] py-6" data-testid="chrono-vide">
        <h3 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">{fr("Chrono")}</h3>
        <p className="text-graphite">{fr("Aucun élément pour l'instant.")}</p>
      </div>
    );
  }

  const selection =
    filtrés.find((item) => item.id === selectionId) ?? filtrés[0] ?? null;

  return (
    <>
      <div className="chrono-liste" data-testid="chrono-liste">
        <div className="chrono-liste__tete">
          <h3>{fr("Chrono")}</h3>
          <div
            className="chrono-filtres"
            role="toolbar"
            aria-label={fr("Filtres du chrono")}
            data-testid="chrono-filtres"
          >
            {FILTRES.map((f) => (
              <button
                key={f}
                type="button"
                className={filtre === f ? "chrono-filtre chrono-filtre--actif" : "chrono-filtre"}
                aria-pressed={filtre === f}
                data-testid={`chrono-filtre-${f}`}
                onClick={() => {
                  setFiltre(f);
                }}
              >
                {fr(FILTRE_LIBELLES[f])}
              </button>
            ))}
          </div>
        </div>

        <div data-testid="chrono-items" role="listbox" aria-label={fr("Éléments du chrono")}>
          {PERIODES.map((periode) => {
            const duGroupe = filtrés.filter((item) => item.periode === periode);
            if (duGroupe.length === 0) return null;
            return (
              <div key={periode} data-testid={`chrono-groupe-${periode}`}>
                <div className="chrono-groupe">{fr(PERIODE_LIBELLES[periode])}</div>
                {duGroupe.map((item) => {
                  const sel = selection?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      tabIndex={0}
                      aria-selected={sel}
                      className={sel ? "chrono-item chrono-item--sel" : "chrono-item"}
                      data-testid="chrono-item"
                      data-type={item.type}
                      data-id={item.id}
                      onClick={() => {
                        setSelectionId(item.id);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setSelectionId(item.id);
                        }
                      }}
                    >
                      <span className="chrono-tuile">
                        <IconeTypeChrono type={item.type} />
                      </span>
                      <div>
                        <div className="chrono-item__titre">{fr(item.titre)}</div>
                        <div className="chrono-item__meta">{fr(item.metadonnees)}</div>
                      </div>
                      <div className="chrono-item__droite">
                        {item.badge !== undefined ? (
                          <BadgeDefinitif libelle={item.badge} />
                        ) : item.heure !== undefined ? (
                          <span className="chrono-item__heure">{fr(item.heure)}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {selection !== null ? (
        <ApercuChrono item={selection} />
      ) : (
        <div className="chrono-apercu" data-testid="chrono-apercu">
          <p className="text-graphite">{fr("Sélectionnez un élément du chrono.")}</p>
        </div>
      )}
    </>
  );
}
