import { fr } from "@/lib/fr";

export type ActionBarre = {
  id: string;
  label: string;
  primaire?: boolean;
  raccourci?: string;
  onClick: () => void;
};

type BarreActionsProps = {
  actions: ActionBarre[];
};

export function BarreActions({ actions }: BarreActionsProps) {
  return (
    <div className="barre-actions" data-testid="barre-actions" role="toolbar" aria-label={fr("Actions")}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={
            action.primaire ? "barre-actions__btn barre-actions__btn--prim" : "barre-actions__btn"
          }
          onClick={action.onClick}
        >
          {fr(action.label)}
          {action.raccourci !== undefined ? (
            <kbd className="barre-actions__kbd">{action.raccourci}</kbd>
          ) : null}
        </button>
      ))}
    </div>
  );
}
