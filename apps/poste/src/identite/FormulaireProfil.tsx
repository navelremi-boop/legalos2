import { useState } from "react";
import {
  CIVILITES_MEMBRE,
  QUALITES_MEMBRE,
  saisieBarreauToque,
  saisieDepuisProfil,
  validerProfil,
  type ChampProfil,
  type ProfilMembre,
  type ProfilSaisie,
} from "@/identite/profilMembre";
import type { ResultatProfil } from "@/identite/profilApi";
import { fr } from "@/lib/fr";

type FormulaireProfilProps = {
  profil: ProfilMembre;
  horsLigne: boolean;
  /** Préfixe des `data-testid` (« profil », « utilisateur »). */
  prefixe: string;
  onEnregistrer: (saisie: ProfilSaisie) => Promise<ResultatProfil>;
  onEnregistre?: (profil: ProfilMembre) => void;
  onAnnuler?: () => void;
};

/**
 * Formulaire d'identité d'un membre : civilité, prénom, nom, qualité et, pour un avocat, barreau et toque.
 * Les contrôles et le corps de la requête sont dans `profilMembre.ts` ; ici, seulement l'affichage.
 * Hors ligne : message et saisie désactivée.
 */
export function FormulaireProfil({ profil, horsLigne, prefixe, onEnregistrer, onEnregistre, onAnnuler }: FormulaireProfilProps) {
  const [saisie, setSaisie] = useState<ProfilSaisie>(() => saisieDepuisProfil(profil));
  const [erreurs, setErreurs] = useState<Partial<Record<ChampProfil, string>>>({});
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const avocat = saisieBarreauToque(saisie.qualite);

  const modifier = (champ: ChampProfil, valeur: string) => {
    setSaisie((etat) => ({ ...etat, [champ]: valeur }));
    setMessage(null);
  };

  const soumettre = () => {
    if (horsLigne || enCours) return;
    const trouvees = validerProfil(saisie);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length > 0) {
      setMessage({ texte: Object.values(trouvees)[0] ?? "", erreur: true });
      return;
    }
    setEnCours(true);
    void onEnregistrer(saisie).then((resultat) => {
      setEnCours(false);
      if (resultat.ok) {
        setMessage({ texte: "Identité enregistrée.", erreur: false });
        onEnregistre?.(resultat.profil);
      } else {
        setMessage({ texte: resultat.message, erreur: true });
      }
    });
  };

  const champDesactive = horsLigne || enCours;
  return (
    <form
      className="profil-formulaire"
      data-testid={`${prefixe}-formulaire`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        soumettre();
      }}
    >
      {horsLigne ? (
        <p className="message-info" role="status" data-testid={`${prefixe}-hors-ligne`}>
          {fr("Hors ligne : l'identité se modifie en ligne seulement.")}
        </p>
      ) : null}
      <div className="profil-formulaire__ligne">
        <div>
          <label className="etiquette-champ" htmlFor={`${prefixe}-civilite`}>
            {fr("Civilité")}
          </label>
          <select
            id={`${prefixe}-civilite`}
            className="champ w-full"
            data-testid={`${prefixe}-civilite`}
            disabled={champDesactive}
            aria-invalid={erreurs.civilite !== undefined}
            value={saisie.civilite}
            onChange={(event) => {
              modifier("civilite", event.target.value);
            }}
          >
            <option value="">{fr("Non renseignée")}</option>
            {CIVILITES_MEMBRE.map((civilite) => (
              <option key={civilite.code} value={civilite.code}>
                {fr(civilite.libelle)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiquette-champ" htmlFor={`${prefixe}-qualite`}>
            {fr("Qualité")}
          </label>
          <select
            id={`${prefixe}-qualite`}
            className="champ w-full"
            data-testid={`${prefixe}-qualite`}
            disabled={champDesactive}
            aria-invalid={erreurs.qualite !== undefined}
            value={saisie.qualite}
            onChange={(event) => {
              modifier("qualite", event.target.value);
            }}
          >
            <option value="">{fr("Non renseignée")}</option>
            {QUALITES_MEMBRE.map((qualite) => (
              <option key={qualite.code} value={qualite.code}>
                {fr(qualite.libelle)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="profil-formulaire__ligne">
        <div>
          <label className="etiquette-champ" htmlFor={`${prefixe}-prenom`}>
            {fr("Prénom")}
          </label>
          <input
            id={`${prefixe}-prenom`}
            className="champ w-full"
            data-testid={`${prefixe}-prenom`}
            autoComplete="off"
            disabled={champDesactive}
            aria-invalid={erreurs.prenom !== undefined}
            value={saisie.prenom}
            onChange={(event) => {
              modifier("prenom", event.target.value);
            }}
          />
        </div>
        <div>
          <label className="etiquette-champ" htmlFor={`${prefixe}-nom`}>
            {fr("Nom")}
          </label>
          <input
            id={`${prefixe}-nom`}
            className="champ w-full"
            data-testid={`${prefixe}-nom`}
            autoComplete="off"
            disabled={champDesactive}
            aria-invalid={erreurs.nom !== undefined}
            value={saisie.nom}
            onChange={(event) => {
              modifier("nom", event.target.value);
            }}
          />
        </div>
      </div>
      {avocat ? (
        <div className="profil-formulaire__ligne" data-testid={`${prefixe}-avocat`}>
          <div>
            <label className="etiquette-champ" htmlFor={`${prefixe}-barreau`}>
              {fr("Barreau")}
            </label>
            <input
              id={`${prefixe}-barreau`}
              className="champ w-full"
              data-testid={`${prefixe}-barreau`}
              autoComplete="off"
              disabled={champDesactive}
              aria-invalid={erreurs.barreau !== undefined}
              value={saisie.barreau}
              onChange={(event) => {
                modifier("barreau", event.target.value);
              }}
            />
          </div>
          <div>
            <label className="etiquette-champ" htmlFor={`${prefixe}-toque`}>
              {fr("Toque")}
            </label>
            <input
              id={`${prefixe}-toque`}
              className="champ w-full"
              data-testid={`${prefixe}-toque`}
              autoComplete="off"
              disabled={champDesactive}
              aria-invalid={erreurs.toque !== undefined}
              value={saisie.toque}
              onChange={(event) => {
                modifier("toque", event.target.value);
              }}
            />
          </div>
        </div>
      ) : null}
      {message !== null ? (
        <p
          className={message.erreur ? "message-erreur" : "message-info"}
          role={message.erreur ? "alert" : "status"}
          data-testid={`${prefixe}-message`}
        >
          {fr(message.texte)}
        </p>
      ) : null}
      <div className="profil-formulaire__pied">
        <button
          type="submit"
          className="bouton bouton--prim"
          data-testid={`${prefixe}-enregistrer`}
          disabled={champDesactive}
        >
          {fr("Enregistrer")}
        </button>
        {onAnnuler !== undefined ? (
          <button type="button" className="bouton bouton--discret" data-testid={`${prefixe}-annuler`} onClick={onAnnuler}>
            {fr("Annuler")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
