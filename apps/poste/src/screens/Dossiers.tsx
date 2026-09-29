import { useEffect, useState } from "react";
import { Feuille } from "@/coque/Feuille";
import { FormulaireDossier } from "@/dossiers/FormulaireDossier";
import { PaletteCommandes } from "@/dossiers/PaletteCommandes";
import { fr } from "@/lib/fr";
import { libelleReferenceDossier } from "@/lib/referenceDossier";
import { getPowerSyncDatabase } from "@/sync/database";

type LigneDossier = {
  id: string;
  nom: string;
  chemise: string;
  reference: string | null;
};

type DossiersProps = {
  onOuvrirDossier?: (
    id: string,
    nom: string,
    chemise: string,
    reference?: string | null,
  ) => void;
  onNouveauDossier?: () => void;
};

export function Dossiers({ onOuvrirDossier, onNouveauDossier }: DossiersProps) {
  const [lignes, setLignes] = useState<LigneDossier[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void getPowerSyncDatabase()
        .then((database) =>
          database.getAll<LigneDossier>(
            "SELECT id, nom, chemise, reference FROM dossiers ORDER BY nom LIMIT 50",
          ),
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
          <div className="flex flex-wrap items-center gap-3">
            <PaletteCommandes
              onChoisirDossier={onOuvrirDossier}
              onNouveauDossier={onNouveauDossier}
            />
            {onNouveauDossier !== undefined ? (
              <button
                type="button"
                className="rounded-[var(--radius-control)] border border-filet bg-page px-3 py-2 text-encre"
                data-testid="dossiers-nouveau"
                onClick={onNouveauDossier}
              >
                {fr("Nouveau dossier")}
              </button>
            ) : null}
          </div>
          <FormulaireDossier
            onCree={({ id, nom, chemise, reference }) => {
              onOuvrirDossier?.(id, nom, chemise, reference);
            }}
          />
          <section>
            <h2 className="mb-3 text-[length:var(--font-size-section)] font-extrabold">
              {fr("Dossiers du cabinet")}
            </h2>
            {lignes.length === 0 ? (
              <p className="text-graphite">{fr("Aucun dossier pour l’instant. Créez-en un ci-dessus.")}</p>
            ) : (
              <ul className="divide-y divide-filet">
                {lignes.map((ligne) => {
                  const reference = libelleReferenceDossier(ligne.reference);
                  return (
                    <li key={ligne.id}>
                      <button
                        type="button"
                        className="flex h-11 w-full items-center gap-3 px-2 text-left hover:bg-survol"
                        data-chemise={ligne.chemise}
                        data-reference={reference}
                        data-testid="liste-dossier"
                        data-dossier-id={ligne.id}
                        onClick={() => {
                          onOuvrirDossier?.(ligne.id, ligne.nom, ligne.chemise, ligne.reference);
                        }}
                      >
                        <span
                          className="h-[13px] w-[9px] shrink-0 rounded-[2px] bg-chemise-bande"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-[length:var(--font-size-meta)] font-bold text-graphite">
                            {fr(reference)}
                          </span>
                          <span className="mx-2 text-filet" aria-hidden>
                            —
                          </span>
                          <span>{fr(ligne.nom)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </Feuille>
    </div>
  );
}
