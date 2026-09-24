import type { ReactNode } from "react";
import { fr } from "@/lib/fr";

type OnboardingShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function OnboardingShell({ title, subtitle, children }: OnboardingShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-6 py-10 text-encre">
      <div
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-tab)] border border-filet bg-classeur shadow-[var(--shadow-floating)]"
        data-chemise="bleu-classeur"
      >
        <div className="bg-chemise-teinte px-8 py-6 text-chemise-texte">
          <p className="text-[length:var(--font-size-dense)] opacity-80">{fr("LEGAL OS")}</p>
          <h1 className="mt-1 text-[length:var(--font-size-section)] font-bold leading-tight">
            {fr(title)}
          </h1>
          {subtitle !== undefined && subtitle !== "" ? (
            <p className="mt-2 text-[length:var(--font-size-dense)] opacity-90">{fr(subtitle)}</p>
          ) : null}
        </div>
        <div className="border-t border-filet bg-feuille px-8 py-6">{children}</div>
      </div>
    </div>
  );
}
