import { fr } from "@/lib/fr";
import type { ChronoItem } from "./types";
import { IconeEncart } from "./icones";

type ApercuChronoProps = {
  item: ChronoItem;
};

export function ApercuChrono({ item }: ApercuChronoProps) {
  const { apercu, type } = item;
  const pourcent =
    apercu.progres !== undefined ? Math.round(apercu.progres * 100) : undefined;

  return (
    <div
      className="chrono-apercu"
      data-testid="chrono-apercu"
      data-type={type}
      role="region"
      aria-label={fr("Aperçu")}
    >
      <div className="chrono-apercu__tete">
        <span className="chrono-apercu__mono" aria-hidden>
          {apercu.mono}
        </span>
        <div className="chrono-apercu__qui">
          <b>{fr(apercu.qui)}</b>
          <span>{fr(apercu.sousTitre)}</span>
        </div>
        <span className="chrono-apercu__quand">{fr(apercu.quand)}</span>
      </div>

      <p className="chrono-apercu__titre">{fr(apercu.titre)}</p>

      {apercu.corps !== undefined && apercu.corps.length > 0 ? (
        <div className="chrono-apercu__corps" data-testid="chrono-apercu-corps">
          {apercu.corps.map((paragraphe) => (
            <p key={paragraphe}>{fr(paragraphe)}</p>
          ))}
        </div>
      ) : null}

      {apercu.chiffres !== undefined ? (
        <>
          <div className="chrono-chiffres" data-testid="chrono-apercu-chiffres">
            {apercu.chiffres.map((c) => (
              <div key={c.libelle}>
                <span>{fr(c.libelle)}</span>
                <b>{fr(c.valeur)}</b>
              </div>
            ))}
          </div>
          {apercu.progres !== undefined ? (
            <>
              <div
                className="chrono-progres"
                role="progressbar"
                aria-valuenow={pourcent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={fr("Part encaissée")}
              >
                <i style={{ width: `${String(pourcent)}%` }} />
              </div>
              <p className="chrono-progres__libelle">
                {fr(`${String(pourcent)} % encaissé`)}
              </p>
            </>
          ) : null}
        </>
      ) : null}

      {apercu.piecesJointes !== undefined || apercu.piecesJointesPlus !== undefined ? (
        <div className="chrono-pj" data-testid="chrono-apercu-pj">
          {apercu.piecesJointes?.map((pj) => (
            <span key={pj.nom} className="chrono-fichier">
              <i>{pj.extension}</i>
              {fr(pj.nom)}
            </span>
          ))}
          {apercu.piecesJointesPlus !== undefined ? (
            <span className="chrono-fichier chrono-fichier--plus">
              {fr(apercu.piecesJointesPlus)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        className="chrono-encart"
        data-testid="chrono-encart"
        data-variante={apercu.encart.variante}
      >
        <IconeEncart variante={apercu.encart.variante} />
        <div>
          <b>{fr(apercu.encart.titre)}</b>
          {fr(apercu.encart.detail)}
        </div>
        {apercu.encart.actionChanger === true ? (
          <button type="button">{fr("Changer")}</button>
        ) : null}
      </div>
    </div>
  );
}
