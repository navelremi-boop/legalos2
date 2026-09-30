import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
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
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]"
      data-testid="ecran-facturation"
      data-fond="neutre"
    >
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-texte-sur-neutre">
        {fr("Facturation")}
      </h1>
      <Feuille uneColonne className="min-h-[360px]">
        <div className="p-[22px] pb-24">
          <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">{fr("Factures")}</h2>
          {lignes.length === 0 ? (
            <p className="text-graphite" data-testid="facturation-vide">
              {fr("Aucune facture à afficher pour l'instant. Saisissez du temps pour préparer un brouillon.")}
            </p>
          ) : (
            <ul className="divide-y divide-filet" data-testid="facturation-liste">
              {lignes.map((ligne) => (
                <li key={ligne.id} className="flex items-center gap-3 py-2" data-testid="facture-ligne" data-statut={ligne.statut}>
                  <span className="font-bold">{fr(ligne.statut)}</span>
                  <span className="min-w-0 flex-1 truncate">{fr(ligne.libelle)}</span>
                  <span className="text-graphite">{fr(ligne.montant)}</span>
                </li>
              ))}
            </ul>
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
