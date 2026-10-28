import type { ReactNode } from "react";

type FeuilleProps = {
  children: ReactNode;
  uneColonne?: boolean;
  className?: string;
};

export function Feuille({ children, uneColonne = false, className = "" }: FeuilleProps) {
  return (
    <div className={`feuille-pile ${className}`.trim()}>
      <div className="feuille-pile__carte feuille-pile__carte--loin" aria-hidden />
      <div className="feuille-pile__carte feuille-pile__carte--proche" aria-hidden />
      <div
        className={`feuille-surface relative z-[1] min-h-0 h-full overflow-hidden ${uneColonne ? "" : "grid grid-cols-[minmax(0,1fr)_22rem]"}`}
        data-testid="feuille"
      >
        {children}
      </div>
    </div>
  );
}
