import { chiffresCode, repartirCode } from "@/onboarding/codeConnexion";
import { fr } from "@/lib/fr";

const caseClass =
  "w-10 rounded-[var(--radius-control)] border border-filet bg-feuille px-0 py-2 text-center text-encre";

type SaisieCodeProps = {
  valeur: string;
  onChange: (code: string) => void;
};

/** Six cases, et un champ `#code-totp` qui garde le code entier pour les recettes. */
export function SaisieCode({ valeur, onChange }: SaisieCodeProps) {
  const code = repartirCode(valeur);
  const cases = chiffresCode(code);

  function ecrire(index: number, saisie: string) {
    const chiffres = saisie.replace(/\D/g, "");
    if (chiffres.length > 1) {
      onChange(repartirCode(chiffres));
      return;
    }
    const suivant = cases.slice();
    suivant[index] = chiffres.slice(-1);
    onChange(repartirCode(suivant.join("")));
  }

  return (
    <div className="relative mb-4">
      <label className="text-[length:var(--font-size-dense)] text-graphite" htmlFor="code-totp">
        {fr("Code à 6 chiffres")}
      </label>
      <input
        id="code-totp"
        name="codeTotp"
        value={code}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={fr("Code à 6 chiffres")}
        className="absolute h-px w-px opacity-0"
        onChange={(event) => {
          onChange(repartirCode(event.target.value));
        }}
      />
      <div className="mt-1 flex gap-2" role="group" aria-label={fr("Code à 6 chiffres")}>
        {cases.map((chiffre, index) => (
          <input
            key={index}
            data-testid={`otp-${String(index)}`}
            inputMode="numeric"
            maxLength={6}
            value={chiffre}
            aria-label={fr(`Chiffre ${String(index + 1)}`)}
            autoComplete="off"
            className={caseClass}
            onChange={(event) => {
              ecrire(index, event.target.value);
            }}
            onPaste={(event) => {
              const texte = event.clipboardData.getData("text");
              if (!/\d/u.test(texte)) return;
              event.preventDefault();
              onChange(repartirCode(texte));
            }}
          />
        ))}
      </div>
    </div>
  );
}
