import { SaisieCode } from "@/onboarding/SaisieCode";
import {
  LIGNES_PREPARATION,
  contenuConnexion,
  progressionPreparation,
  type EtatConnexion,
} from "@/onboarding/etatsConnexion";
import { fr } from "@/lib/fr";

const champClass =
  "mt-1 w-full rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre";

type EcranConnexionProps = {
  etat: EtatConnexion;
  /** Reprendre sans effacer les données locales. */
  onContinuer?: () => void;
};

function Champ({
  id,
  label,
  type = "text",
}: {
  id: string;
  label: string;
  type?: string;
}) {
  return (
    <label className="mt-3 block text-[length:var(--font-size-dense)] text-graphite" htmlFor={id}>
      {fr(label)}
      <input id={id} type={type} readOnly defaultValue="" className={champClass} />
    </label>
  );
}

/** Présentation des onze états. Les recettes de saisie restent dans le parcours réel. */
export function EcranConnexion({ etat, onContinuer }: EcranConnexionProps) {
  const contenu = contenuConnexion(etat);
  const parts = etat === "sync" ? progressionPreparation("apercu") : [];
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
            <b>{fr(contenu.alerte.titre)}</b> {fr(contenu.alerte.texte)}
          </p>
        ) : null}
        {etat === "adresse" || etat === "chiffrement" ? (
          <>
            <Champ id="connexion-adresse" label="Adresse du serveur" />
            <ul className="mt-4" data-testid="connexion-verifications">
              <li>
                {fr("Chiffrement du disque")}
                {" — "}
                {fr(etat === "chiffrement" ? "Non détecté" : "Détecté")}
              </li>
              <li>
                {fr("Coffre des identifiants")}
                {" — "}
                {fr("Accessible")}
              </li>
            </ul>
          </>
        ) : null}
        {etat === "connexion" || etat === "mdp" ? (
          <>
            <Champ id="connexion-email" label="Adresse e-mail" />
            <Champ id="connexion-mot-de-passe" label="Mot de passe" type="password" />
          </>
        ) : null}
        {etat === "otp" || etat === "otpe" ? (
          <div className="mt-4">
            <SaisieCode valeur={etat === "otpe" ? "000000" : ""} onChange={() => undefined} />
          </div>
        ) : null}
        {etat === "verrou" ? (
          <Champ id="connexion-deverrouiller" label="Mot de passe" type="password" />
        ) : null}
        {etat === "sync" ? (
          <ul className="mt-4" data-testid="connexion-progression">
            {LIGNES_PREPARATION.map((nom, index) => (
              <li key={nom} className="mb-2">
                <span>{fr(nom)}</span> <span>{fr(`${String(parts[index] ?? 0)} %`)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {contenu.info ? (
          <p className="mt-4" data-testid="connexion-info">
            <b>{fr(contenu.info.titre)}</b> {fr(contenu.info.texte)}
          </p>
        ) : null}
        <p className="mt-4">
          <button
            type="button"
            className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
            data-testid="connexion-continuer"
            onClick={() => {
              onContinuer?.();
            }}
          >
            {fr(contenu.bouton)}
          </button>
        </p>
      </div>
    </div>
  );
}
