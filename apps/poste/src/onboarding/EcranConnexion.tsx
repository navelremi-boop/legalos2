import { SaisieCode } from "@/onboarding/SaisieCode";
import {
  LIGNES_PREPARATION,
  contenuConnexion,
  progressionPreparation,
  type EtatConnexion,
} from "@/onboarding/etatsConnexion";
import { fr } from "@/lib/fr";

const champClass =
  "champ mt-1";

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
    <label className="etiquette-champ mt-4" htmlFor={id}>
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
      className="fond-neutre flex h-full min-h-0 flex-col items-center justify-center px-[var(--gouttiere)] py-8"
      data-testid="ecran-connexion"
      data-etat={etat}
      data-fond="neutre"
    >
      <div className="carte-connexion">
        <p className="carte-connexion__marque">{fr("LEGAL OS")}</p>
        <h1 className="carte-connexion__titre">{fr(contenu.titre)}</h1>
        <p className="mt-2 text-graphite">{fr(contenu.sousTitre)}</p>
        {contenu.alerte ? (
          <p className="message-erreur mt-4 block" role="alert" data-testid="connexion-alerte">
            <b>{fr(contenu.alerte.titre)}</b> {fr(contenu.alerte.texte)}
          </p>
        ) : null}
        {etat === "adresse" || etat === "chiffrement" ? (
          <>
            <Champ id="connexion-adresse" label="Adresse du serveur" />
            <ul className="verifications mt-5" data-testid="connexion-verifications">
              <li data-etat={etat === "chiffrement" ? "attention" : "ok"}>
                <span>{fr("Chiffrement du disque")}</span>
                <span className="sr-only">{" — "}</span>
                <b>{fr(etat === "chiffrement" ? "Non détecté" : "Détecté")}</b>
              </li>
              <li data-etat="ok">
                <span>{fr("Coffre des identifiants")}</span>
                <span className="sr-only">{" — "}</span>
                <b>{fr("Accessible")}</b>
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
            {contenu.lienSecours ? (
              <p className="mt-3">
                <button type="button" className="lien-action" data-testid="connexion-secours">
                  {fr("Utiliser un code de secours")}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        {etat === "verrou" ? (
          <Champ id="connexion-deverrouiller" label="Mot de passe" type="password" />
        ) : null}
        {etat === "sync" ? (
          <ul className="progression mt-5" data-testid="connexion-progression">
            {LIGNES_PREPARATION.map((nom, index) => (
              <li key={nom}>
                <span>{fr(nom)}</span> <span className="montant">{fr(`${String(parts[index] ?? 0)} %`)}</span>
                <i aria-hidden style={{ width: `${String(parts[index] ?? 0)}%` }} />
              </li>
            ))}
          </ul>
        ) : null}
        {contenu.info ? (
          <p className="message-info mt-4" data-testid="connexion-info">
            <b>{fr(contenu.info.titre)}</b> {fr(contenu.info.texte)}
          </p>
        ) : null}
        <p className="mt-6">
          <button
            type="button"
            className="bouton bouton--prim w-full"
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
