import { useEffect, useState } from "react";
import { codeQualite, effetRetraitQualite } from "@/contacts/intervenants";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { assurerJetonAcces } from "@/lib/session/rafraichir";
import { getPowerSyncDatabase } from "@/sync/database";

export type QualiteReglage = {
  id: string;
  code: string;
  libelle: string;
  admetRattachement: boolean;
  archivee: boolean;
  utilisee: boolean;
};

type PanneauQualitesProps = {
  /** Galerie : liste figée, modifications locales. */
  demo?: readonly QualiteReglage[];
  instanceUrl: string;
  horsLigne: boolean;
};

export function PanneauQualites({ demo, instanceUrl, horsLigne }: PanneauQualitesProps) {
  const [lignes, setLignes] = useState<QualiteReglage[]>(demo === undefined ? [] : [...demo]);
  const [libelle, setLibelle] = useState("");
  const [admet, setAdmet] = useState(false);
  const [message, setMessage] = useState(
    demo === undefined && horsLigne ? "Hors ligne : les qualités se modifient en ligne." : "",
  );
  const modifiable = demo !== undefined || !horsLigne;

  useEffect(() => {
    if (demo !== undefined) return;
    void (async () => {
      try {
        const database = await getPowerSyncDatabase();
        const rows = await database.getAll<{
          id: string;
          code: string;
          libelle: string;
          admet_rattachement: number | null;
          archivee: number | null;
          utilisee: number | null;
        }>(
          `SELECT q.id, q.code, q.libelle, q.admet_rattachement, q.archivee,
              EXISTS(SELECT 1 FROM dossier_intervenants i WHERE i.qualite_id = q.id) AS utilisee
           FROM qualites q ORDER BY q.libelle COLLATE NOCASE`,
        );
        setLignes(
          rows.map((ligne) => ({
            id: ligne.id,
            code: ligne.code,
            libelle: ligne.libelle,
            admetRattachement: ligne.admet_rattachement === 1,
            archivee: ligne.archivee === 1,
            utilisee: ligne.utilisee === 1,
          })),
        );
      } catch {
        setLignes([]);
      }
    })();
  }, [demo]);

  const archiver = (ligne: QualiteReglage) => {
    if (!modifiable) return;
    const appliquer = (effet: "archive" | "supprime") => {
      setLignes((etat) =>
        effet === "supprime"
          ? etat.filter((item) => item.id !== ligne.id)
          : etat.map((item) => (item.id === ligne.id ? { ...item, archivee: true } : item)),
      );
      setMessage(effet === "archive" ? "Qualité archivée." : "Qualité retirée.");
    };
    if (demo !== undefined) {
      appliquer(effetRetraitQualite(ligne.utilisee));
      return;
    }
    void (async () => {
      const jeton = await assurerJetonAcces();
      if (jeton === null) {
        setMessage("La session a expiré. Reconnectez-vous.");
        return;
      }
      const reponse = await fetch(apiUrl(instanceUrl, `/qualites/${ligne.id}/retrait`), {
        method: "POST",
        headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
        body: JSON.stringify({ idempotence_cle: crypto.randomUUID() }),
      });
      if (reponse.status === 403) {
        setMessage("La modification est réservée aux administrateurs du cabinet.");
        return;
      }
      if (!reponse.ok) {
        setMessage("La qualité n'a pas pu être retirée.");
        return;
      }
      const corps = (await reponse.json()) as { effet?: string };
      appliquer(corps.effet === "supprime" ? "supprime" : "archive");
    })();
  };

  const ajouter = () => {
    let code: string;
    try {
      code = codeQualite(libelle);
    } catch {
      setMessage("Libellé requis.");
      return;
    }
    if (lignes.some((ligne) => ligne.code === code && !ligne.archivee)) {
      setMessage("Cette qualité existe déjà.");
      return;
    }
    const ligne: QualiteReglage = {
      id: crypto.randomUUID(),
      code,
      libelle: libelle.trim(),
      admetRattachement: admet,
      archivee: false,
      utilisee: false,
    };
    if (demo !== undefined) {
      setLignes((etat) => [...etat, ligne]);
      setLibelle("");
      setMessage("Qualité ajoutée.");
      return;
    }
    void (async () => {
      const jeton = await assurerJetonAcces();
      if (jeton === null) {
        setMessage("La session a expiré. Reconnectez-vous.");
        return;
      }
      const reponse = await fetch(apiUrl(instanceUrl, "/qualites"), {
        method: "POST",
        headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
        body: JSON.stringify({
          id: ligne.id,
          idempotence_cle: crypto.randomUUID(),
          code,
          libelle: ligne.libelle,
          admet_rattachement: admet,
        }),
      });
      if (reponse.status === 403) {
        setMessage("La modification est réservée aux administrateurs du cabinet.");
        return;
      }
      if (reponse.status === 409) {
        setMessage("Cette qualité existe déjà.");
        return;
      }
      if (!reponse.ok) {
        setMessage("La qualité n'a pas pu être ajoutée.");
        return;
      }
      setLignes((etat) => [...etat, ligne]);
      setLibelle("");
      setMessage("Qualité ajoutée.");
    })();
  };

  return (
    <div data-testid="reglages-qualites">
      <h2 className="feuille-titre mb-3">{fr("Qualités")}</h2>
      <p className="mb-3">{fr("Une qualité utilisée dans un dossier s'archive. Une qualité jamais utilisée est retirée.")}</p>
      <ul className="flex flex-col gap-2" data-testid="reglages-qualites-liste">
        {lignes.map((ligne) => (
          <li key={ligne.id} className="flex items-center gap-2" data-testid="reglages-qualite">
            <span>
              {fr(ligne.libelle)}
              {ligne.admetRattachement ? fr(" — rattachement") : ""}
              {ligne.archivee ? fr(" — archivée") : ""}
            </span>
            {modifiable && !ligne.archivee ? (
              <button
                type="button"
                className="filtre"
                data-testid={`reglages-qualite-retirer-${ligne.code}`}
                onClick={() => {
                  archiver(ligne);
                }}
              >
                {fr("Retirer")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {modifiable ? (
        <form
          className="mt-4 flex flex-col gap-2"
          data-testid="reglages-qualite-ajout"
          onSubmit={(event) => {
            event.preventDefault();
            ajouter();
          }}
        >
          <label className="flex flex-col gap-1">
            <span>{fr("Nouvelle qualité")}</span>
            <input
              className="champ"
              data-testid="reglages-qualite-libelle"
              value={libelle}
              onChange={(event) => {
                setLibelle(event.target.value);
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid="reglages-qualite-rattachement"
              checked={admet}
              onChange={(event) => {
                setAdmet(event.target.checked);
              }}
            />
            {fr("Admet un rattachement")}
          </label>
          <button type="submit" className="filtre" data-testid="reglages-qualite-ajouter">
            {fr("Ajouter")}
          </button>
        </form>
      ) : null}
      {message !== "" ? <p data-testid="reglages-qualites-message">{fr(message)}</p> : null}
    </div>
  );
}
