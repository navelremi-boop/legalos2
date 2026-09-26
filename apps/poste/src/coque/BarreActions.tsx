import type { ReactNode } from "react";
import {
  IconCalendarEvent,
  IconClock,
  IconFileInvoice,
  IconFolderPlus,
  IconMail,
} from "@tabler/icons-react";
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

function IconeAction({ id }: { id: string }): ReactNode {
  const props = { size: 15, stroke: 1.8, "aria-hidden": true as const };
  switch (id) {
    case "nouveau-mail":
      return <IconMail {...props} />;
    case "saisir-temps":
      return <IconClock {...props} />;
    case "facturer":
      return <IconFileInvoice {...props} />;
    case "calculer-delai":
      return <IconCalendarEvent {...props} />;
    case "nouveau-dossier":
      return <IconFolderPlus {...props} />;
    default:
      return null;
  }
}

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
          <IconeAction id={action.id} />
          {fr(action.label)}
          {action.raccourci !== undefined ? (
            <kbd className="barre-actions__kbd">{action.raccourci}</kbd>
          ) : null}
        </button>
      ))}
    </div>
  );
}
