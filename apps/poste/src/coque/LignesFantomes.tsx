import { fr } from "@/lib/fr";

/** Lignes provisoires pendant la première lecture de la base locale : jamais un écran vide trompeur. */
export function LignesFantomes({ nombre = 4 }: { nombre?: number }) {
  return (
    <div className="lignes-fantomes" role="status" data-testid="lignes-fantomes">
      <span className="sr-only">{fr("Chargement…")}</span>
      {Array.from({ length: nombre }, (_, index) => (
        <div key={index} className="lignes-fantomes__ligne" aria-hidden="true">
          <span className="lignes-fantomes__pastille" />
          <span className="lignes-fantomes__texte">
            <span style={{ width: `${String(62 - ((index * 13) % 30))}%` }} />
            <span style={{ width: `${String(38 - ((index * 7) % 15))}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
