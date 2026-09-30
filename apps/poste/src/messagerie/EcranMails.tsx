import { useEffect, useState } from "react";
import { Feuille } from "@/coque/Feuille";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { rechercherMailsHorsLigne, type ResultatRechercheMail } from "@/messagerie/rechercheMails";

type LigneEnvoi = {
  id: string;
  objet: string;
  destinataire: string;
  etat: string;
};

const LIBELLES: Record<string, string> = {
  brouillon: "Brouillon",
  en_attente: "En attente",
  envoye: "Envoyé",
  copie_envoyes_confirmee: "Copie dans « Envoyés » confirmée",
  echec: "Échec",
};

async function lireFile(instanceUrl: string): Promise<LigneEnvoi[]> {
  const jeton = loadSessionTokens().accessToken;
  if (jeton === null || jeton === "") return [];
  const reponse = await fetch(apiUrl(instanceUrl, "/messagerie/file-envoi"), {
    headers: { authorization: `Bearer ${jeton}` },
  });
  if (!reponse.ok) return [];
  const json: unknown = await reponse.json();
  if (!Array.isArray(json)) return [];
  const lignes: LigneEnvoi[] = [];
  for (const ligne of json) {
    if (typeof ligne !== "object" || ligne === null) continue;
    const row = ligne as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.etat !== "string") continue;
    lignes.push({
      id: row.id,
      objet: typeof row.objet === "string" ? row.objet : "",
      destinataire: typeof row.destinataire === "string" ? row.destinataire : "",
      etat: row.etat,
    });
  }
  return lignes;
}

async function poster(instanceUrl: string, chemin: string): Promise<void> {
  const jeton = loadSessionTokens().accessToken;
  if (jeton === null || jeton === "") return;
  await fetch(apiUrl(instanceUrl, chemin), {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}` },
  });
}

type EcranMailsProps = {
  instanceUrl: string;
};

/**
 * File d'envoi (§ 3.8.3) et recherche hors ligne.
 * L'écran en trois volets reste le jalon J10.
 */
export function EcranMails({ instanceUrl }: EcranMailsProps) {
  const [lignes, setLignes] = useState<LigneEnvoi[]>([]);
  const [terme, setTerme] = useState("");
  const [hits, setHits] = useState<ResultatRechercheMail[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void lireFile(instanceUrl).then((rows) => {
        if (!stop) setLignes(rows);
      });
    };
    tick();
    const timer = window.setInterval(tick, 1_500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [instanceUrl]);

  useEffect(() => {
    let stop = false;
    void rechercherMailsHorsLigne(terme)
      .then((rows) => {
        if (!stop) setHits(rows);
      })
      .catch(() => {
        if (!stop) setHits([]);
      });
    return () => {
      stop = true;
    };
  }, [terme]);

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]"
      data-testid="ecran-mails"
    >
      <Feuille uneColonne className="min-h-[360px]">
        <div className="p-[22px]">
          <h2 className="mb-4 text-[length:var(--font-size-section)] font-extrabold">{fr("Mails")}</h2>
          <label className="mb-2 block text-[length:var(--font-size-dense)] text-graphite" htmlFor="recherche-mails">
            {fr("Recherche hors ligne")}
          </label>
          <input
            id="recherche-mails"
            className="mb-4 w-full max-w-md rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-encre"
            data-testid="recherche-mails"
            value={terme}
            onChange={(event) => {
              setTerme(event.target.value);
            }}
          />
          <ul data-testid="recherche-mails-resultats">
            {hits.map((hit) => (
              <li key={hit.id} data-testid="recherche-mail-hit" data-id={hit.id}>
                {fr(hit.objet || "(sans objet)")}
              </li>
            ))}
          </ul>

          <h3 className="mt-6 mb-3 text-[length:var(--font-size-section)] font-extrabold">{fr("File d'envoi")}</h3>
          {lignes.length === 0 ? (
            <p className="text-graphite">{fr("Aucun envoi pour l'instant.")}</p>
          ) : (
            <ul className="divide-y divide-filet">
              {lignes.map((ligne) => (
                <li
                  key={ligne.id}
                  className="flex flex-wrap items-center gap-3 py-2"
                  data-testid="file-envoi-ligne"
                  data-id={ligne.id}
                  data-etat={ligne.etat}
                >
                  <span className="font-bold">{fr(LIBELLES[ligne.etat] ?? ligne.etat)}</span>
                  <span className="min-w-0 flex-1 truncate">{fr(ligne.objet || "(sans objet)")}</span>
                  <span className="text-graphite">{fr(ligne.destinataire)}</span>
                  {ligne.etat === "en_attente" ? (
                    <button
                      type="button"
                      className="rounded-[var(--radius-control)] border border-filet px-2 py-1"
                      data-testid="file-envoi-annuler"
                      onClick={() => {
                        void poster(instanceUrl, `/messagerie/file-envoi/${ligne.id}/annuler`).then(() =>
                          lireFile(instanceUrl).then(setLignes),
                        );
                      }}
                    >
                      {fr("Annuler")}
                    </button>
                  ) : null}
                  {ligne.etat === "echec" ? (
                    <button
                      type="button"
                      className="rounded-[var(--radius-control)] border border-filet px-2 py-1"
                      data-testid="file-envoi-reessayer"
                      onClick={() => {
                        void poster(instanceUrl, `/messagerie/file-envoi/${ligne.id}/traiter`).then(() =>
                          lireFile(instanceUrl).then(setLignes),
                        );
                      }}
                    >
                      {fr("Nouvelle tentative")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Feuille>
    </div>
  );
}
