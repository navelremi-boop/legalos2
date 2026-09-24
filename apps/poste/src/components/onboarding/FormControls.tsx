import type { InputHTMLAttributes, ReactNode } from "react";
import { fr } from "@/lib/fr";

const fieldClass =
  "mt-1 w-full rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-encre";

type FieldProps = {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
};

export function Field({ id, label, children, hint }: FieldProps) {
  return (
    <div className="mb-4">
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor={id}>
        {fr(label)}
      </label>
      {children}
      {hint !== undefined && hint !== "" ? (
        <p className="mt-1 text-[length:var(--font-size-meta)] text-graphite">{fr(hint)}</p>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

type PrimaryButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
};

export function PrimaryButton({
  children,
  disabled = false,
  type = "button",
  onClick,
}: PrimaryButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className="inline-flex h-[30px] w-full items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-chemise-teinte px-3 text-[length:var(--font-size-dense)] font-bold text-chemise-texte hover:outline hover:outline-1 hover:outline-chemise-bande disabled:cursor-not-allowed disabled:opacity-50"
      data-chemise="bleu-classeur"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type SecondaryButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
};

export function SecondaryButton({ children, disabled = false, onClick }: SecondaryButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="inline-flex h-[30px] w-full items-center justify-center rounded-[var(--radius-control)] border border-filet bg-feuille px-3 text-[length:var(--font-size-dense)] text-encre hover:border-graphite disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      className="mb-4 rounded-[var(--radius-control)] border border-filet bg-echeance-fond px-3 py-2 text-[length:var(--font-size-dense)] text-echeance"
      role="alert"
    >
      {fr(message)}
    </p>
  );
}
