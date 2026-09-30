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

export type MailLocal = {
  id: string;
  objet: string | null;
  etat_classement: string | null;
  dossier_id: string | null;
  suggestion_dossier_id: string | null;
  expediteur: string | null;
  destinataires?: string | null;
  texte_brut?: string | null;
  cree_le?: string | null;
  dossier_imap?: string | null;
  pieces?: string[];
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

const DOSSIERS_IMAP = [
  { id: "INBOX", libelle: "Boîte de réception" },
  { id: "Envoyés", libelle: "Envoyés" },
] as const;

function dansDossier(mail: MailLocal, id: string): boolean {
  const dossier = (mail.dossier_imap ?? "INBOX").trim().toLowerCase();
  if (id === "INBOX") return dossier === "" || dossier === "inbox";
  return dossier === "envoyés" || dossier === "envoyes" || dossier === "sent";
}

function dateCourte(valeur: string | null | undefined): string {
  if (!valeur) return "";
  const jour = /^(\d{4}-\d{2}-\d{2})/.exec(valeur);
  return jour?.[1] ?? valeur.slice(0, 16);
}

function extrait(mail: MailLocal): string {
  const texte = mail.texte_brut?.replace(/\s+/g, " ").trim() ?? "";
  if (texte === "") return "";
  return texte.length > 90 ? `${texte.slice(0, 90)}…` : texte;
}

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

export type DemonstrationMails = {
  comptes: CompteLocal[];
  mails: MailLocal[];
  dossiers: DossierLocal[];
  file?: LigneEnvoi[];
};

type EcranMailsProps = {
  instanceUrl: string;
  onNouveauDossier?: () => void;
  onSaisirTemps?: () => void;
  /** Galerie seulement : pas d'appel PowerSync. */
  demonstration?: DemonstrationMails;
};

/**
 * Trois volets (§ 7.6) : comptes et dossiers IMAP, liste, lecture.
 * La recherche est en tête de liste. La file d'envoi est hors du volet de lecture.
 */
export function EcranMails({
  instanceUrl,
  onNouveauDossier,
  onSaisirTemps,
  demonstration,
}: EcranMailsProps) {
  const [lignes, setLignes] = useState<LigneEnvoi[]>(demonstration?.file ?? []);
  const [terme, setTerme] = useState("");
  const [hits, setHits] = useState<ResultatRechercheMail[]>([]);
  const [comptes, setComptes] = useState<CompteLocal[]>([]);
  const [mails, setMails] = useState<MailLocal[]>([]);
  const [dossiers, setDossiers] = useState<DossierLocal[]>([]);
  const [dossierImap, setDossierImap] = useState<(typeof DOSSIERS_IMAP)[number]["id"]>("INBOX");
  const [selection, setSelection] = useState<string | null>(() => {
    const aClasser = demonstration?.mails.find((mail) => mail.etat_classement !== "classe");
    return aClasser?.id ?? demonstration?.mails[0]?.id ?? null;
  });

  useEffect(() => {
    if (demonstration) return;
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
              `SELECT id, objet, etat_classement, dossier_id, suggestion_dossier_id, expediteur,
                      texte_brut, cree_le, dossier_imap
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
  }, [instanceUrl, demonstration]);

  useEffect(() => {
    if (demonstration) return;
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
  }, [terme, demonstration]);

  const comptesAffiches = demonstration?.comptes ?? comptes;
  const mailsAffiches = (demonstration?.mails ?? mails).filter((mail) => dansDossier(mail, dossierImap));
  const dossiersAffiches = demonstration?.dossiers ?? dossiers;
  const parId = new Map(dossiersAffiches.map((dossier) => [dossier.id, dossier]));
  const choisi = mailsAffiches.find((mail) => mail.id === selection) ?? mailsAffiches[0] ?? null;
  const classe = choisi?.etat_classement === "classe";
  const dossierClasse = choisi?.dossier_id ? parId.get(choisi.dossier_id) : undefined;
  const suggestionId = choisi?.suggestion_dossier_id ?? choisi?.dossier_id ?? null;
  const suggestion = suggestionId ? parId.get(suggestionId) : undefined;
  const libelleDossier = DOSSIERS_IMAP.find((dossier) => dossier.id === dossierImap)?.libelle ?? dossierImap;
  const resultats = demonstration
    ? mailsAffiches.filter((mail) => {
        const tas = `${mail.objet ?? ""} ${mail.texte_brut ?? ""} ${mail.expediteur ?? ""}`.toLowerCase();
        return terme.trim() === "" || tas.includes(terme.trim().toLowerCase());
      })
    : null;

  return (
    <div
      className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]"
      data-testid="ecran-mails"
      data-fond="neutre"
    >
      <Feuille uneColonne className="min-h-[420px]">
        <div className="flex h-full min-h-[420px] flex-col">
          <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)_minmax(0,1.2fr)]" data-testid="mails-trois-volets">
            <aside className="border-r border-filet p-3" data-testid="mails-comptes">
              <h2 className="mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr("Comptes")}</h2>
              {comptesAffiches.length === 0 ? (
                <p className="mb-3 text-graphite">{fr("Aucun compte synchronisé.")}</p>
              ) : (
                <ul className="mb-3">
                  {comptesAffiches.map((compte) => (
                    <li key={compte.id} data-testid="compte-mail">
                      {fr(compte.adresse)}
                    </li>
                  ))}
                </ul>
              )}
              <h2 className="mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr("Dossiers")}</h2>
              <ul>
                {DOSSIERS_IMAP.map((dossier) => (
                  <li key={dossier.id}>
                    <button
                      type="button"
                      className="w-full rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-survol"
                      data-testid="dossier-imap"
                      data-dossier={dossier.id}
                      aria-pressed={dossierImap === dossier.id}
                      onClick={() => {
                        setDossierImap(dossier.id);
                      }}
                    >
                      {fr(dossier.libelle)}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="border-r border-filet p-3" data-testid="mails-liste">
              <h2 className="mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr(libelleDossier)}</h2>
              <label className="mb-2 block text-[length:var(--font-size-dense)] text-graphite" htmlFor="recherche-mails">
                {fr("Recherche")}
              </label>
              <input
                id="recherche-mails"
                className="mb-3 w-full rounded-[var(--radius-control)] border border-filet bg-feuille px-3 py-2 text-encre"
                data-testid="recherche-mails"
                value={terme}
                onChange={(event) => {
                  setTerme(event.target.value);
                }}
              />
              {terme.trim() !== "" && !demonstration ? (
                <ul className="mb-3" data-testid="recherche-mails-resultats">
                  {hits.map((hit) => (
                    <li key={hit.id} data-testid="recherche-mail-hit" data-id={hit.id}>
                      {fr(hit.objet || "(sans objet)")}
                    </li>
                  ))}
                </ul>
              ) : null}
              {mailsAffiches.length === 0 ? (
                <p className="text-graphite">{fr("Aucun message dans cette boîte.")}</p>
              ) : (
                <ul>
                  {(resultats ?? mailsAffiches).map((mail) => {
                    const dossier = mail.dossier_id ? parId.get(mail.dossier_id) : undefined;
                    const apercu = extrait(mail);
                    return (
                      <li key={mail.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col gap-0.5 rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-survol"
                          data-testid="mail-ligne"
                          data-id={mail.id}
                          data-etat={mail.etat_classement ?? ""}
                          onClick={() => {
                            setSelection(mail.id);
                          }}
                        >
                          <span className="flex items-center gap-2">
                            {mail.etat_classement === "classe" && dossier ? (
                              <span
                                className="ligne-journee__pastille"
                                data-testid="pastille-mail"
                                data-chemise={dossier.chemise}
                                aria-hidden
                              />
                            ) : null}
                            <span className="min-w-0 flex-1 truncate font-bold">{fr(mail.expediteur || "—")}</span>
                            <span className="shrink-0 text-[length:var(--font-size-meta)] text-graphite">
                              {fr(dateCourte(mail.cree_le))}
                            </span>
                          </span>
                          <span className="truncate">{fr(mail.objet?.trim() || "(sans objet)")}</span>
                          {apercu !== "" ? (
                            <span className="truncate text-[length:var(--font-size-meta)] text-graphite">{fr(apercu)}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className="overflow-auto p-3" data-testid="mails-lecture">
              {choisi ? (
                <>
                  <p className="font-bold" data-testid="lecture-expediteur">
                    {fr(choisi.expediteur || "—")}
                  </p>
                  <p className="text-graphite" data-testid="lecture-destinataires">
                    {fr(choisi.destinataires?.trim() || "—")}
                  </p>
                  <p className="mb-3 text-[length:var(--font-size-meta)] text-graphite" data-testid="lecture-date">
                    {fr(dateCourte(choisi.cree_le) || "—")}
                  </p>
                  <h2 className="mb-3 text-[length:var(--font-size-section)] font-extrabold">
                    {fr(choisi.objet?.trim() || "(sans objet)")}
                  </h2>
                  {!classe ? (
                    <p className="mb-3 rounded-[var(--radius-control)] bg-survol px-3 py-2" data-testid="banniere-classer">
                      {fr(`Classer dans ${suggestion?.nom ?? "un dossier"}`)}
                    </p>
                  ) : null}
                  {classe && dossierClasse ? (
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
                  {!classe ? (
                    <button
                      type="button"
                      className="mb-4 rounded-[var(--radius-control)] border border-filet px-3 py-2"
                      data-testid="bouton-classer"
                    >
                      {fr("Classer")}
                    </button>
                  ) : null}
                  <p className="whitespace-pre-wrap" data-testid="lecture-corps">
                    {fr(choisi.texte_brut?.trim() || "")}
                  </p>
                  <h3 className="mt-4 mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr("Pièces jointes")}</h3>
                  {(choisi.pieces ?? []).length === 0 ? (
                    <p className="text-graphite">{fr("Aucune pièce jointe.")}</p>
                  ) : (
                    <ul data-testid="lecture-pieces">
                      {(choisi.pieces ?? []).map((piece) => (
                        <li key={piece}>{fr(piece)}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-graphite">{fr("Sélectionnez un message.")}</p>
              )}
            </section>
          </div>
          <section className="border-t border-filet p-3" data-testid="mails-file">
            <h3 className="mb-2 text-[length:var(--font-size-dense)] font-extrabold">{fr("File d'envoi")}</h3>
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
          { id: "nouveau-mail", label: "Nouveau mail", onClick: () => undefined },
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
