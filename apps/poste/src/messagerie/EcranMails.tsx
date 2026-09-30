import { useEffect, useState } from "react";
import { BarreActions } from "@/coque/BarreActions";
import { Feuille } from "@/coque/Feuille";
import { apiUrl } from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { rechercherMailsHorsLigne, type ResultatRechercheMail } from "@/messagerie/rechercheMails";
import { getPowerSyncDatabase } from "@/sync/database";

type LigneEnvoi = {
  id: string;
  objet: string;
  destinataire: string;
  etat: string;
};

type MailLocal = {
  id: string;
  objet: string | null;
  etat_classement: string | null;
  dossier_id: string | null;
  suggestion_dossier_id: string | null;
  expediteur: string | null;
};

type DossierLocal = { id: string; nom: string; chemise: string };
type CompteLocal = { id: string; adresse: string; type_compte: string };

const LIBELLES: Record<string, string> = {
  brouillon: "Brouillon",
  en_attente: "En attente",
  envoye: "Envoyé",
  copie_envoyes_confirmee: "Copie dans « Envoyés » confirmée",
  echec: "Échec",
};

const DOSSIERS_IMAP = ["INBOX", "Envoyés", "Archives"];

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
  onNouveauDossier?: () => void;
  onSaisirTemps?: () => void;
};

/**
 * Trois volets (§ 7.6) : comptes et dossiers IMAP, liste, lecture.
 * La file d'envoi et la recherche hors ligne restent dans le volet de lecture.
 */
export function EcranMails({ instanceUrl, onNouveauDossier, onSaisirTemps }: EcranMailsProps) {
  const [lignes, setLignes] = useState<LigneEnvoi[]>([]);
  const [terme, setTerme] = useState("");
  const [hits, setHits] = useState<ResultatRechercheMail[]>([]);
  const [comptes, setComptes] = useState<CompteLocal[]>([]);
  const [mails, setMails] = useState<MailLocal[]>([]);
  const [dossiers, setDossiers] = useState<DossierLocal[]>([]);
  const [dossierImap, setDossierImap] = useState(DOSSIERS_IMAP[0] ?? "INBOX");
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      void lireFile(instanceUrl).then((rows) => {
        if (!stop) setLignes(rows);
      });
      void getPowerSyncDatabase()
        .then(async (database) => {
          const [comptesRows, mailRows, dossierRows] = await Promise.all([
            database.getAll<CompteLocal>("SELECT id, adresse, type_compte FROM comptes_mail ORDER BY adresse"),
            database.getAll<MailLocal>(
              `SELECT id, objet, etat_classement, dossier_id, suggestion_dossier_id, expediteur
               FROM messages ORDER BY cree_le DESC`,
            ),
            database.getAll<DossierLocal>("SELECT id, nom, chemise FROM dossiers"),
          ]);
          return { comptesRows, mailRows, dossierRows };
        })
        .then((rows) => {
          if (stop) return;
          setComptes(rows.comptesRows);
          setMails(rows.mailRows);
          setDossiers(rows.dossierRows);
        })
        .catch(() => {
          if (stop) return;
          setComptes([]);
          setMails([]);
          setDossiers([]);
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

  const parId = new Map(dossiers.map((dossier) => [dossier.id, dossier]));
  const choisi = mails.find((mail) => mail.id === selection) ?? mails[0] ?? null;
  const classe = choisi?.etat_classement === "classe";
  const dossierClasse = choisi?.dossier_id ? parId.get(choisi.dossier_id) : undefined;
  const suggestionId = choisi?.suggestion_dossier_id ?? choisi?.dossier_id ?? null;
  const suggestion = suggestionId ? parId.get(suggestionId) : undefined;

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]"
      data-testid="ecran-mails"
      data-fond="neutre"
    >
      <Feuille uneColonne className="min-h-[420px]">
        <div className="grid h-full min-h-[420px] grid-cols-[200px_minmax(0,1fr)_minmax(0,1.2fr)]" data-testid="mails-trois-volets">
          <aside className="border-r border-filet p-3" data-testid="mails-comptes">
            <h2 className="mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr("Comptes")}</h2>
            {comptes.length === 0 ? (
              <p className="mb-3 text-graphite">{fr("Aucun compte synchronisé.")}</p>
            ) : (
              <ul className="mb-3">
                {comptes.map((compte) => (
                  <li key={compte.id} data-testid="compte-mail">
                    {fr(compte.adresse)}
                  </li>
                ))}
              </ul>
            )}
            <h2 className="mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr("Dossiers")}</h2>
            <ul>
              {DOSSIERS_IMAP.map((nom) => (
                <li key={nom}>
                  <button
                    type="button"
                    className="w-full rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-survol"
                    data-testid="dossier-imap"
                    aria-pressed={dossierImap === nom}
                    onClick={() => {
                      setDossierImap(nom);
                    }}
                  >
                    {fr(nom)}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="border-r border-filet p-3" data-testid="mails-liste">
            <h2 className="mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr(dossierImap)}</h2>
            {mails.length === 0 ? (
              <p className="text-graphite">{fr("Aucun message dans cette boîte.")}</p>
            ) : (
              <ul>
                {mails.map((mail) => {
                  const dossier = mail.dossier_id ? parId.get(mail.dossier_id) : undefined;
                  return (
                    <li key={mail.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-survol"
                        data-testid="mail-ligne"
                        data-id={mail.id}
                        data-etat={mail.etat_classement ?? ""}
                        onClick={() => {
                          setSelection(mail.id);
                        }}
                      >
                        {mail.etat_classement === "classe" && dossier ? (
                          <span
                            className="ligne-journee__pastille"
                            data-testid="pastille-mail"
                            data-chemise={dossier.chemise}
                            aria-hidden
                          />
                        ) : null}
                        <span className="truncate">{fr(mail.objet?.trim() || "(sans objet)")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="overflow-auto p-3" data-testid="mails-lecture">
            {choisi && !classe ? (
              <p className="mb-3 rounded-[var(--radius-control)] bg-survol px-3 py-2" data-testid="banniere-classer">
                {fr(`Classer dans ${suggestion?.nom ?? "un dossier"}`)}
              </p>
            ) : null}
            {choisi && classe && dossierClasse ? (
              <p className="mb-3 flex items-center gap-2">
                <span
                  className="ligne-journee__pastille"
                  data-testid="pastille-lecture"
                  data-chemise={dossierClasse.chemise}
                  aria-hidden
                />
                {fr(dossierClasse.nom)}
              </p>
            ) : null}
            <label className="mb-2 block text-[length:var(--font-size-dense)] text-graphite" htmlFor="recherche-mails">
              {fr("Recherche hors ligne")}
            </label>
            <input
              id="recherche-mails"
              className="mb-4 w-full rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-encre"
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
          </section>
        </div>
      </Feuille>
      <BarreActions
        actions={[
          {
            id: "nouveau-dossier",
            label: "Nouveau dossier",
            onClick: () => {
              onNouveauDossier?.();
            },
          },
          { id: "nouveau-mail", label: "Nouveau mail", primaire: true, onClick: () => undefined },
          {
            id: "saisir-temps",
            label: "Saisir du temps",
            onClick: () => {
              onSaisirTemps?.();
            },
          },
        ]}
      />
    </div>
  );
}
