import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { TexteReferences } from "@/coque/TexteReferences";
import { IconeCadenas } from "@/coque/chrono/icones";
import { fr } from "@/lib/fr";

export type LigneFactureDemo = {
  id: string;
  libelle: string;
  statut: string;
  montant: string;
};

type EcranFacturationProps = {
  onNouveauDossier: () => void;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
  /** Galerie : jeu fictif, pas d'appel API. */
  lignes?: LigneFactureDemo[];
};

/** Feuille unique hors dossier (§ 7.6). Le formulaire de temps s'ouvre depuis la barre. */
export function EcranFacturation({
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
  lignes = [],
}: EcranFacturationProps) {
  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col ecran"
      data-testid="ecran-facturation"
      data-fond="neutre"
    >
      <header className="ecran-tete">
        <div>
          <h1 className="ecran-tete__titre">{fr("Facturation")}</h1>
          <p className="ecran-tete__sous-titre">
            {fr(lignes.length === 0 ? "Aucune facture pour l'instant" : `${String(lignes.length)} pièces de facturation`)}
          </p>
        </div>
      </header>
      <Feuille uneColonne className="min-h-[360px]">
        <div className="p-[22px] pb-24">
          <h2 className="feuille-titre mb-3">{fr("Factures")}</h2>
          {lignes.length === 0 ? (
            <p className="etat-vide" data-testid="facturation-vide">
              {fr("Aucune facture à afficher pour l'instant. Saisissez du temps pour préparer un brouillon.")}
            </p>
          ) : (
            <div className="factures">
              <p className="factures__entete" aria-hidden="true">
                <span>{fr("État")}</span>
                <span>{fr("Pièce")}</span>
                <span className="montant">{fr("Montant")}</span>
              </p>
              <ul data-testid="facturation-liste">
                {lignes.map((ligne) => (
                  <li key={ligne.id} className="factures__ligne" data-testid="facture-ligne" data-statut={ligne.statut}>
                    <span>
                      {ligne.statut === "Brouillon" ? (
                        <span className="etat-brouillon">{fr(ligne.statut)}</span>
                      ) : (
                        <span className="badge-definitif">
                          <IconeCadenas />
                          {fr(ligne.statut)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 truncate">
                      <TexteReferences texte={ligne.libelle} />
                    </span>
                    <span className="montant font-bold">{fr(ligne.montant)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Feuille>
      <BarreActions
        actions={[
          { id: "nouveau-dossier", label: "Nouveau dossier", onClick: onNouveauDossier },
          { id: "nouveau-mail", label: "Nouveau mail", onClick: onNouveauMail },
          { id: "saisir-temps", label: "Saisir du temps", onClick: onSaisirTemps },
        ]}
      />
    </div>
  );
}
