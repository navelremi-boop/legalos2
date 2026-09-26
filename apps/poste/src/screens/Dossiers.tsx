import { useEffect, useState } from "react";
import { Feuille } from "@/coque/Feuille";
import { FormulaireDossier } from "@/dossiers/FormulaireDossier";
import { PaletteCommandes } from "@/dossiers/PaletteCommandes";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

type LigneDossier = {
  id: string;
  nom: string;
  chemise: string;
};

type DossiersProps = {
  onOuvrirDossier?: (id: string, nom: string, chemise: string) => void;
};

export function Dossiers({ onOuvrirDossier }: DossiersProps) {
  const [lignes, setLignes] = useState<LigneDossier[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          database.getAll<LigneDossier>("SELECT id, nom, chemise FROM dossiers ORDER BY nom LIMIT 50"),
        )
        .then((rows) => {
          if (!stop) setLignes(rows);
        })
        .catch(() => {
          if (!stop) setLignes([]);
        });
    };
    tick();
    const timer = window.setInterval(tick, 2_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]" data-testid="ecran-dossiers">
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-sur-chemise">
        {fr("Dossiers")}
      </h1>
      <Feuille uneColonne className="min-h-[420px]">
        <div className="space-y-8 p-[22px] pb-16">
          <PaletteCommandes />
          <FormulaireDossier />
          <section>
            <h2 className="mb-3 text-[length:var(--font-size-section)] font-extrabold">
              {fr("Dossiers du cabinet")}
            </h2>
            {lignes.length === 0 ? (
              <p className="text-graphite">{fr("Aucun dossier pour l’instant. Créez-en un ci-dessus.")}</p>
            ) : (
              <ul className="divide-y divide-filet">
                {lignes.map((ligne) => (
                  <li key={ligne.id}>
                    <button
                      type="button"
                      className="flex h-11 w-full items-center gap-3 px-2 text-left hover:bg-survol"
                      data-chemise={ligne.chemise}
                      onClick={() => {
                        onOuvrirDossier?.(ligne.id, ligne.nom, ligne.chemise);
                      }}
                    >
                      <span
                        className="h-[13px] w-[9px] shrink-0 rounded-[2px] bg-chemise-bande"
                        aria-hidden
                      />
                      <span>{fr(ligne.nom)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Feuille>
    </div>
  );
}
