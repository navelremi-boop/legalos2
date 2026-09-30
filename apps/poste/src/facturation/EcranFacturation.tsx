import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";

type EcranFacturationProps = {
  onNouveauDossier: () => void;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
};

/** Feuille unique hors dossier (§ 7.6). Le formulaire de temps s'ouvre depuis la barre. */
export function EcranFacturation({
  onNouveauDossier,
  onNouveauMail,
  onSaisirTemps,
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
          <p className="text-graphite">
            {fr("Aucune facture à afficher pour l'instant. Saisissez du temps pour préparer un brouillon.")}
          </p>
        </div>
      </Feuille>
      <BarreActions
        actions={[
          { id: "nouveau-dossier", label: "Nouveau dossier", onClick: onNouveauDossier },
          { id: "nouveau-mail", label: "Nouveau mail", onClick: onNouveauMail },
          { id: "saisir-temps", label: "Saisir du temps", primaire: true, onClick: onSaisirTemps },
        ]}
      />
    </div>
  );
}
