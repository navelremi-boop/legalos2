import { fr } from "@/lib/fr";
import type { BadgeDefinitifLibelle } from "./types";
import { IconeCadenas } from "./icones";

type BadgeDefinitifProps = {
  libelle: BadgeDefinitifLibelle;
};

/** Badge « définitif » (§ 7.4) — jeton `definitif`, réservé à l’immuable. */
export function BadgeDefinitif({ libelle }: BadgeDefinitifProps) {
  return (
    <span className="badge-definitif" data-testid="badge-definitif">
      <IconeCadenas />
      {fr(libelle)}
    </span>
  );
}
