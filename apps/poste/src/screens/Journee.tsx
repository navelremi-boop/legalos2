import { Feuille } from "@/coque/Feuille";
import { BarreActions } from "@/coque/BarreActions";
import { fr } from "@/lib/fr";

type JourneeProps = {
  onNouveauDossier: () => void;
  onNouveauMail: () => void;
  onSaisirTemps: () => void;
};

export function Journee({ onNouveauDossier, onNouveauMail, onSaisirTemps }: JourneeProps) {
  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px] pb-0"
      data-testid="ecran-journee"
      data-fond="neutre"
    >
      <div className="sr-only" data-testid="fond-neutre">
        {fr("Fond neutre")}
      </div>
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-sur-chemise">
        {fr("La journée")}
      </h1>
      <Feuille uneColonne className="min-h-[420px]">
        <div className="grid gap-8 p-[22px] pb-24 md:grid-cols-2">
          <section>
            <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
              {fr("Audiences et rendez-vous")}
            </h2>
            <p className="text-graphite">{fr("Aucune audience ni rendez-vous aujourd’hui.")}</p>
          </section>
          <section>
            <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
              {fr("Délais")}
            </h2>
            <p className="text-graphite">{fr("Aucun délai à surveiller pour le moment.")}</p>
          </section>
          <section>
            <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
              {fr("Mails à classer")}
            </h2>
            <p className="text-graphite">{fr("Aucun mail en attente de classement.")}</p>
          </section>
          <section>
            <h2 className="mb-2 text-[length:var(--font-size-section)] font-extrabold">
              {fr("Temps à saisir")}
            </h2>
            <p className="text-graphite">{fr("Aucun temps en attente de saisie.")}</p>
          </section>
        </div>
      </Feuille>
      <BarreActions
        actions={[
          { id: "nouveau-dossier", label: "Nouveau dossier", primaire: true, onClick: onNouveauDossier },
          { id: "nouveau-mail", label: "Nouveau mail", onClick: onNouveauMail },
          { id: "saisir-temps", label: "Saisir du temps", raccourci: "T", onClick: onSaisirTemps },
        ]}
      />
    </div>
  );
}
