import { useState } from "react";
import { fr } from "@/lib/fr";
import {
  champsVides,
  portImapParDefaut,
  problemeConnexion,
  type ChampsConnexion,
  type ModeConnexion,
} from "@/messagerie/formesConnexionBoite";

/**
 * Formulaire de connexion d'une boîte (Réglages, Messagerie) : serveur IMAP, identifiants, relais SMTP facultatif.
 * Les identifiants restent dans le formulaire le temps de la saisie : à l'envoi réussi, le formulaire se ferme et ils
 * disparaissent du poste.
 */

type FormulaireConnexionBoiteProps = {
  mode: ModeConnexion;
  /** Adresse de la boîte à reconnecter (non modifiable). */
  adresse?: string;
  envoiEnCours: boolean;
  erreur: string | null;
  onEnvoyer: (champs: ChampsConnexion) => void;
  onAnnuler: () => void;
};

export function FormulaireConnexionBoite({
  mode,
  adresse,
  envoiEnCours,
  erreur,
  onEnvoyer,
  onAnnuler,
}: FormulaireConnexionBoiteProps) {
  const [champs, setChamps] = useState<ChampsConnexion>(() => champsVides(adresse ?? ""));
  const [problemeLocal, setProblemeLocal] = useState<string | null>(null);
  const maj = (changement: Partial<ChampsConnexion>) => {
    setChamps((actuel) => ({ ...actuel, ...changement }));
    setProblemeLocal(null);
  };
  const champ = (id: keyof ChampsConnexion, etiquette: string, options: { type?: string; sansAuto?: boolean } = {}) => (
    <div className="rg-mess__champ">
      <label htmlFor={`connexion-${id}`}>{fr(etiquette)}</label>
      <input
        id={`connexion-${id}`}
        data-testid={`connexion-${id}`}
        type={options.type ?? "text"}
        value={String(champs[id])}
        autoComplete={options.type === "password" ? "new-password" : "off"}
        spellCheck={false}
        onChange={(event) => {
          maj({ [id]: event.target.value });
        }}
      />
    </div>
  );

  return (
    <form
      className="rg-mess__formulaire"
      data-testid="connexion-formulaire"
      data-mode={mode}
      aria-label={fr(mode === "ajout" ? "Ajouter une boîte" : "Reconnecter la boîte")}
      onSubmit={(event) => {
        event.preventDefault();
        const probleme = problemeConnexion(champs, mode);
        setProblemeLocal(probleme);
        if (probleme === null) onEnvoyer(champs);
      }}
    >
      {mode === "ajout" ? (
        champ("adresse", "Adresse de la boîte")
      ) : (
        <p className="rg-mess__desc" data-testid="connexion-adresse-fixe">
          {fr(`Boîte ${adresse ?? ""}. Pour des raisons de sécurité, les paramètres ne sont jamais conservés sur le poste : saisissez-les de nouveau.`)}
        </p>
      )}
      {champ("hote", "Serveur IMAP")}
      <div className="rg-mess__champ">
        <label htmlFor="connexion-port">{fr("Port IMAP")}</label>
        <input
          id="connexion-port"
          data-testid="connexion-port"
          type="text"
          inputMode="numeric"
          value={champs.port}
          autoComplete="off"
          onChange={(event) => {
            maj({ port: event.target.value });
          }}
        />
      </div>
      <label className="rg-mess__case">
        <input
          type="checkbox"
          data-testid="connexion-tls"
          checked={champs.tls}
          onChange={(event) => {
            const tls = event.target.checked;
            // Le port suit le chiffrement tant qu'il est resté à sa valeur usuelle.
            const usuel = champs.port === portImapParDefaut(champs.tls);
            maj({ tls, ...(usuel ? { port: portImapParDefaut(tls) } : {}) });
          }}
        />
        {fr("Connexion chiffrée (TLS)")}
      </label>
      {champ("utilisateur", "Identifiant")}
      {champ("motDePasse", "Mot de passe", { type: "password" })}
      <details className="rg-mess__details">
        <summary>{fr("Envoi (SMTP), facultatif")}</summary>
        <p className="rg-mess__desc">
          {fr("Sans serveur d'envoi propre, la boîte envoie par le relais du cabinet.")}
        </p>
        {champ("smtpHote", "Serveur SMTP")}
        {champ("smtpPort", "Port SMTP")}
        {champ("smtpUtilisateur", "Identifiant d'envoi")}
        {champ("smtpMotDePasse", "Mot de passe d'envoi", { type: "password" })}
        {champ("repondreA", "Adresse de réponse")}
      </details>
      {problemeLocal !== null || erreur !== null ? (
        <p className="rg-mess__erreur" role="alert" data-testid="connexion-erreur">
          {fr(problemeLocal ?? erreur ?? "")}
        </p>
      ) : null}
      <div className="rg-mess__actions">
        <button type="submit" className="rg-mess__bouton" data-fort="true" data-testid="connexion-envoyer" disabled={envoiEnCours}>
          {fr(envoiEnCours ? "Connexion…" : mode === "ajout" ? "Connecter la boîte" : "Reconnecter")}
        </button>
        <button type="button" className="rg-mess__bouton" data-testid="connexion-annuler" onClick={onAnnuler}>
          {fr("Annuler")}
        </button>
      </div>
    </form>
  );
}
