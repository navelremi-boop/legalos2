import { IconFolderPlus } from "@tabler/icons-react";
import { fr } from "@/lib/fr";
import type { BoiteRail, IdBoite } from "@/messagerie/boitesMail";
import { presenterEnvoi } from "@/messagerie/fileEnvoi";
import type { LigneEnvoi } from "@/messagerie/typesMails";

/** Vue ouverte dans la liste : la vue « À classer » ou un dossier d'une boîte. */
export type VueMails =
  | { genre: "a-classer" }
  | { genre: "dossier"; boite: IdBoite; dossier: string };

type RailMailsProps = {
  aClasser: number;
  vue: VueMails;
  onVue: (vue: VueMails) => void;
  boites: BoiteRail[];
  file: LigneEnvoi[];
  erreurFile: string | null;
  onAnnuler: (id: string) => void;
  onRelancer: (id: string) => void;
};

/**
 * Volet de gauche : « À classer » en tête, les boîtes avec leurs dossiers en français, puis la file d'envoi
 * (hors du volet de lecture).
 */
export function RailMails({
  aClasser,
  vue,
  onVue,
  boites,
  file,
  erreurFile,
  onAnnuler,
  onRelancer,
}: RailMailsProps) {
  return (
    <aside className="mails-rail" data-testid="mails-comptes" aria-label={fr("Boîtes aux lettres")}>
      <button
        type="button"
        className="mails-vue-classer"
        data-testid="vue-a-classer"
        aria-current={vue.genre === "a-classer"}
        onClick={() => {
          onVue({ genre: "a-classer" });
        }}
      >
        <span className="mails-tuile" aria-hidden>
          <IconFolderPlus stroke={1.6} />
        </span>
        {fr("À classer")}
        {aClasser > 0 ? (
          <span className="mails-pastille-n" data-testid="compteur-a-classer">
            {aClasser}
          </span>
        ) : null}
      </button>

      {boites.length === 0 ? (
        <p className="mails-rail__vide">{fr("Aucun compte synchronisé.")}</p>
      ) : null}

      {boites.map((boite) => (
        <div key={boite.id} data-testid="boite-rail" data-boite={boite.id}>
          <div className="mails-compte">
            <b>{fr(boite.titre)}</b>
            {boite.adresses.map((adresse) => (
              <div key={adresse.id} data-testid="compte-mail">
                <span className="mails-compte__adresse" title={adresse.adresse}>
                  <i data-etat={adresse.identifiantsRefuses ? "refuse" : "ok"} aria-hidden />
                  <em>{adresse.adresse}</em>
                </span>
                {adresse.identifiantsRefuses ? (
                  <p className="mails-compte__refus" data-testid="compte-identifiants-refuses">
                    {fr("Identifiants refusés")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          {boite.dossiers.map((dossier) => (
            <button
              key={dossier.cle}
              type="button"
              className="mails-bal"
              data-testid="dossier-imap"
              data-boite={boite.id}
              data-dossier={dossier.cle}
              aria-current={
                vue.genre === "dossier" && vue.boite === boite.id && vue.dossier === dossier.cle
              }
              onClick={() => {
                onVue({ genre: "dossier", boite: boite.id, dossier: dossier.cle });
              }}
            >
              {fr(dossier.libelle)}
              {dossier.compteur !== null ? (
                <span
                  className={
                    dossier.nature === "total" ? "mails-compteur mails-compteur--total" : "mails-compteur"
                  }
                  data-testid="compteur-dossier"
                >
                  {dossier.compteur}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ))}

      <section className="mails-file" data-testid="mails-file" aria-live="polite">
        <h2>{fr("File d'envoi")}</h2>
        {file.length === 0 ? (
          <p className="text-graphite">{fr("Aucun envoi pour l'instant.")}</p>
        ) : (
          file.map((ligne) => {
            const presentation = presenterEnvoi(ligne);
            return (
              <div
                key={ligne.id}
                className="mails-envoi"
                data-testid="file-envoi-ligne"
                data-id={ligne.id}
                data-etat={ligne.etat}
                data-ton={presentation.ton}
              >
                <i aria-hidden />
                <div>
                  <span className="mails-envoi__titre">{fr(ligne.objet.trim() || "(sans objet)")}</span>
                  <span className="mails-envoi__etat">{fr(presentation.etat)}</span>
                  {presentation.annulable ? (
                    <button
                      type="button"
                      className="mails-envoi__action"
                      data-testid="file-envoi-annuler"
                      onClick={() => {
                        onAnnuler(ligne.id);
                      }}
                    >
                      {fr("Annuler")}
                    </button>
                  ) : null}
                  {presentation.relancable ? (
                    <button
                      type="button"
                      className="mails-envoi__action"
                      data-testid="file-envoi-reessayer"
                      onClick={() => {
                        onRelancer(ligne.id);
                      }}
                    >
                      {fr("Nouvelle tentative")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        {erreurFile !== null ? (
          <p className="mails-erreur" role="alert" data-testid="file-envoi-erreur">
            {fr(erreurFile)}
          </p>
        ) : null}
      </section>
    </aside>
  );
}
