import { fr } from "@/lib/fr";

export type IntercalaireId = "chrono" | "procedure" | "pieces" | "mails" | "factures";

export type IntercalaireItem = {
  id: IntercalaireId;
  label: string;
  compteur?: number;
};

export const INTERCALAIRES_STANDARDS: IntercalaireItem[] = [
  { id: "chrono", label: "Chrono", compteur: 0 },
  { id: "procedure", label: "Procédure", compteur: 0 },
  { id: "pieces", label: "Pièces", compteur: 0 },
  { id: "mails", label: "Mails", compteur: 0 },
  { id: "factures", label: "Factures", compteur: 0 },
];

type IntercalairesProps = {
  items?: IntercalaireItem[];
  actif: IntercalaireId;
  onChanger: (id: IntercalaireId) => void;
};

export function Intercalaires({
  items = INTERCALAIRES_STANDARDS,
  actif,
  onChanger,
}: IntercalairesProps) {
  return (
    <div className="intercalaires" data-testid="intercalaires" role="tablist" aria-label={fr("Intercalaires")}>
      {items.map((item) => {
        const estActif = item.id === actif;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={estActif}
            className={estActif ? "intercalaire intercalaire--actif" : "intercalaire"}
            onClick={() => {
              onChanger(item.id);
            }}
          >
            {fr(item.label)}
            {item.compteur !== undefined ? (
              <em className="intercalaire__compteur">{item.compteur}</em>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
