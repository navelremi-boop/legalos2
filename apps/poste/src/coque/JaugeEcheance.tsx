import { fr } from "@/lib/fr";

type JaugeEcheanceProps = {
  joursRestants: number;
  /** Part écoulée entre 0 et 1 */
  partEcoulee: number;
  intitule: string;
  dateLibelle: string;
  urgent?: boolean;
};

export function JaugeEcheance({
  joursRestants,
  partEcoulee,
  intitule,
  dateLibelle,
  urgent = false,
}: JaugeEcheanceProps) {
  const rayon = 26;
  const perimetre = 2 * Math.PI * rayon;
  const progression = Math.min(1, Math.max(0, partEcoulee));
  const trait = perimetre * (1 - progression);
  const couleur = urgent ? "var(--echeance)" : "var(--chemise-accent)";

  return (
    <div className="jauge-echeance" data-testid="jauge-echeance" role="status">
      <svg className="jauge-echeance__anneau" viewBox="0 0 64 64" aria-hidden>
        <circle
          cx="32"
          cy="32"
          r={rayon}
          fill="none"
          stroke="var(--arc-piste)"
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={rayon}
          fill="none"
          stroke={couleur}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={perimetre}
          strokeDashoffset={trait}
          transform="rotate(-90 32 32)"
        />
        <text
          x="32"
          y="36"
          textAnchor="middle"
          fontSize="15"
          fontWeight="800"
          fill={urgent ? "var(--echeance)" : "var(--sur-chemise)"}
        >
          {joursRestants}
        </text>
      </svg>
      <div className="text-[length:var(--font-size-dense)] leading-[1.35]">
        <b className="block text-[15px]">{fr(intitule)}</b>
        <span className="opacity-75">{fr(dateLibelle)}</span>
      </div>
    </div>
  );
}
