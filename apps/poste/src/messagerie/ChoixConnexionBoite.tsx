import { useState } from "react";
import { fr } from "@/lib/fr";
import { adresseValide } from "@/messagerie/formesConnexionBoite";
import type { FournisseurOAuth } from "@/messagerie/formesOAuth";

/**
 * Premier pas de « Ajouter une boîte » (Réglages, Messagerie, Comptes) : le mode de connexion. Soit le formulaire
 * IMAP/SMTP à mot de passe, soit un fournisseur (Microsoft 365, Gmail) : l'adresse de la boîte est demandée ici,
 * puis le navigateur du système s'ouvre sur la page du fournisseur. Aucun mot de passe ne passe par cet écran.
 */

type ChoixConnexionBoiteProps = {
  /** Fournisseurs que l'instance sait connecter ; `null` tant que la liste se charge. */
  fournisseurs: FournisseurOAuth[] | null;
  onMotDePasse: () => void;
  onFournisseur: (fournisseur: FournisseurOAuth, adresse: string) => void;
  onAnnuler: () => void;
};

export function ChoixConnexionBoite({ fournisseurs, onMotDePasse, onFournisseur, onAnnuler }: ChoixConnexionBoiteProps) {
  const [choisi, setChoisi] = useState<FournisseurOAuth | null>(null);
  const [adresse, setAdresse] = useState("");
  const [probleme, setProbleme] = useState<string | null>(null);

  if (choisi !== null) {
    return (
      <form
        className="rg-mess__formulaire"
        data-testid="connexion-oauth-formulaire"
        aria-label={fr(`Connecter une boîte ${choisi.libelle}`)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!adresseValide(adresse)) {
            setProbleme("Saisissez l'adresse de la boîte, par exemple prenom.nom@cabinet.example.");
            return;
          }
          onFournisseur(choisi, adresse.trim());
        }}
      >
        <p className="rg-mess__desc">
          {fr(
            `Le navigateur du système va s'ouvrir sur la page de connexion de ${choisi.libelle}. Le mot de passe de la boîte n'est jamais saisi dans LEGAL OS.`,
          )}
        </p>
        <div className="rg-mess__champ">
          <label htmlFor="connexion-oauth-adresse">{fr("Adresse de la boîte")}</label>
          <input
            id="connexion-oauth-adresse"
            data-testid="connexion-oauth-adresse"
            type="text"
            inputMode="email"
            value={adresse}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setAdresse(event.target.value);
              setProbleme(null);
            }}
          />
        </div>
        {probleme !== null ? (
          <p className="rg-mess__erreur" role="alert" data-testid="connexion-oauth-erreur">
            {fr(probleme)}
          </p>
        ) : null}
        <div className="rg-mess__actions">
          <button type="submit" className="rg-mess__bouton" data-fort="true" data-testid="connexion-oauth-ouvrir">
            {fr("Ouvrir le navigateur")}
          </button>
          <button
            type="button"
            className="rg-mess__bouton"
            data-testid="connexion-oauth-retour"
            onClick={() => {
              setChoisi(null);
              setProbleme(null);
            }}
          >
            {fr("Choisir un autre mode")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="rg-mess__formulaire" data-testid="connexion-choix" role="group" aria-label={fr("Ajouter une boîte")}>
      <p className="rg-mess__desc">{fr("Comment la boîte se connecte-t-elle ?")}</p>
      <div className="rg-mess__actions">
        <button type="button" className="rg-mess__bouton" data-testid="connexion-mode-motdepasse" onClick={onMotDePasse}>
          {fr("Mot de passe (IMAP/SMTP)")}
        </button>
        {(fournisseurs ?? []).map((fournisseur) => (
          <button
            key={fournisseur.id}
            type="button"
            className="rg-mess__bouton"
            data-testid={`connexion-fournisseur-${fournisseur.id}`}
            onClick={() => {
              setChoisi(fournisseur);
            }}
          >
            {fr(fournisseur.libelle)}
          </button>
        ))}
        <button type="button" className="rg-mess__bouton" data-testid="connexion-choix-annuler" onClick={onAnnuler}>
          {fr("Annuler")}
        </button>
      </div>
      {fournisseurs === null ? (
        <p className="rg-mess__note" role="status" data-testid="connexion-fournisseurs-chargement">
          {fr("Recherche des fournisseurs disponibles…")}
        </p>
      ) : null}
    </div>
  );
}
