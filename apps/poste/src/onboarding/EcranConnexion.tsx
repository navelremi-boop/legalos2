import { SaisieCode } from "@/onboarding/SaisieCode";
import { contenuConnexion, type EtatConnexion } from "@/onboarding/etatsConnexion";
import { fr } from "@/lib/fr";

type EcranConnexionProps = {
  etat: EtatConnexion;
};

/** Présentation des onze états. Les recettes de saisie restent dans le parcours réel. */
export function EcranConnexion({ etat }: EcranConnexionProps) {
  const contenu = contenuConnexion(etat);
  return (
    <div
      className="fond-neutre flex h-full min-h-0 flex-col items-center justify-center px-[30px] py-8"
      data-testid="ecran-connexion"
      data-etat={etat}
      data-fond="neutre"
    >
      <div className="w-full max-w-md rounded-[var(--radius-tab)] border border-filet bg-feuille p-6 text-encre">
        <h1 className="text-[length:var(--font-size-section)] font-extrabold">{fr(contenu.titre)}</h1>
        <p className="mt-2 text-graphite">{fr(contenu.sousTitre)}</p>
        {contenu.alerte ? (
          <p className="mt-4" role="alert" data-testid="connexion-alerte">
            <b>{fr(contenu.alerte.titre)}</b>
            {" "}
            {fr(contenu.alerte.texte)}
          </p>
        ) : null}
        {etat === "otp" || etat === "otpe" ? (
          <div className="mt-4">
            <SaisieCode valeur={etat === "otpe" ? "000000" : ""} onChange={() => undefined} />
          </div>
        ) : null}
        {contenu.info ? (
          <p className="mt-4" data-testid="connexion-info">
            <b>{fr(contenu.info.titre)}</b>
            {" "}
            {fr(contenu.info.texte)}
          </p>
        ) : null}
        <p className="mt-4">
          <button
            type="button"
            className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
          >
            {fr(contenu.bouton)}
          </button>
        </p>
      </div>
    </div>
  );
}
