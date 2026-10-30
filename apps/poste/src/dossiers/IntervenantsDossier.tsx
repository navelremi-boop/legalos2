import { useEffect, useState } from "react";
import {
  grouperIntervenants,
  type IntervenantAffiche,
} from "@/contacts/intervenants";
import { fr } from "@/lib/fr";
import { getPowerSyncDatabase } from "@/sync/database";

type LigneSql = {
  id: string;
  rattache_a: string | null;
  code: string;
  libelle: string;
  prenoms: string | null;
  nom: string;
  accord: string | null;
};

function versAffiche(ligne: LigneSql): IntervenantAffiche {
  const accord = ligne.accord === "masculin" || ligne.accord === "feminin" ? ligne.accord : null;
  return {
    id: ligne.id,
    codeQualite: ligne.code,
    libelleQualite: ligne.libelle,
    prenoms: ligne.prenoms,
    nom: ligne.nom,
    accord,
    rattacheA: ligne.rattache_a,
  };
}

export function IntervenantsDossier({
  dossierId,
  lignesFixes,
}: {
  dossierId: string;
  lignesFixes?: readonly IntervenantAffiche[];
}) {
  const [lignesSync, setLignesSync] = useState<IntervenantAffiche[]>([]);
  const lignes = lignesFixes ?? lignesSync;

  useEffect(() => {
    if (lignesFixes !== undefined) return;
    let ignore = false;
    const charger = () => {
      void (async () => {
        try {
          const database = await getPowerSyncDatabase();
          const rows = await database.getAll<LigneSql>(
            `SELECT i.id, i.rattache_a, q.code, q.libelle, c.prenoms, c.nom, c.accord
             FROM dossier_intervenants i
             JOIN qualites q ON q.id = i.qualite_id
             JOIN contacts c ON c.id = i.contact_id
             WHERE i.dossier_id = ?`,
            [dossierId],
          );
          if (!ignore) setLignesSync(rows.map(versAffiche));
        } catch {
          if (!ignore) setLignesSync([]);
        }
      })();
    };
    charger();
    const timer = window.setInterval(charger, 2_000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [dossierId, lignesFixes]);

  const groupes = grouperIntervenants(lignes);
  if (groupes.length === 0) return null;

  return (
    <section className="mt-3 max-w-[var(--lecture-max)] text-sur-chemise" data-testid="dossier-intervenants">
      {groupes.map((groupe) => (
        <div key={groupe.qualite} className="mt-2">
          <h3 className="text-[length:var(--font-size-dense)] font-bold">{fr(groupe.qualite)}</h3>
          <ul>
            {groupe.entrees.map((entree) => (
              <li key={entree.id}>
                <p data-testid="dossier-intervenant">{fr(entree.texte)}</p>
                {entree.enfants.length > 0 ? (
                  <ul className="pl-6">
                    {entree.enfants.map((enfant) => (
                      <li key={enfant.id} data-testid="dossier-intervenant-rattache">
                        {fr(enfant.texte)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
