import { IconPaperclip, IconPencil, IconSearch } from "@tabler/icons-react";
import { fr } from "@/lib/fr";
import { estAClasser, estLu, etiquetteDossier } from "@/messagerie/classement";
import type { DossierClassement } from "@/messagerie/classement";
import { analyserCorrespondant, monogramme, nomAffiche } from "@/messagerie/expediteurs";
import {
  apercuMail,
  dateDuMail,
  horodatageListe,
  listePieces,
  type FiltreListe,
  type GroupeJour,
} from "@/messagerie/listeMails";
import { nomLigneBrouillon } from "@/messagerie/listeBrouillons";
import type { MailLocal } from "@/messagerie/typesMails";

const FILTRES: readonly { id: FiltreListe; libelle: string }[] = [
  { id: "tous", libelle: "Tous" },
  { id: "nonlus", libelle: "Non lus" },
  { id: "pj", libelle: "Pièces jointes" },
];

/** Où en est la recherche sur le serveur : `indisponible` quand l'instance ne répond pas (le poste cherche seul). */
export type EtatRechercheServeur = "inactive" | "en-cours" | "ok" | "indisponible";

type PanneauListeProps = {
  titre: string;
  terme: string;
  onTerme: (terme: string) => void;
  filtre: FiltreListe;
  onFiltre: (filtre: FiltreListe) => void;
  groupes: GroupeJour[];
  /** Vrai quand la liste montre le résultat d'une recherche. */
  enRecherche: boolean;
  messageVide: string;
  selection: string | null;
  onSelection: (id: string) => void;
  dossiers: ReadonlyMap<string, DossierClassement>;
  classesLocal: Readonly<Record<string, string>>;
  maintenant: Date;
  rechercheServeur: EtatRechercheServeur;
};

/** Volet du milieu : recherche en tête, filtres, mails groupés par jour. */
export function PanneauListe({
  titre,
  terme,
  onTerme,
  filtre,
  onFiltre,
  groupes,
  enRecherche,
  messageVide,
  selection,
  onSelection,
  dossiers,
  classesLocal,
  maintenant,
  rechercheServeur,
}: PanneauListeProps) {
  const vide = groupes.length === 0;
  return (
    <section
      className="mails-liste"
      data-testid="mails-liste"
      data-recherche-serveur={rechercheServeur}
      aria-label={fr("Liste des mails")}
    >
      <div className="mails-liste__tete">
        <label className="mails-rech" htmlFor="recherche-mails">
          <IconSearch stroke={1.7} aria-hidden />
          <input
            id="recherche-mails"
            type="search"
            data-testid="recherche-mails"
            placeholder={fr("Rechercher dans tous les mails")}
            aria-label={fr("Rechercher dans tous les mails")}
            value={terme}
            onChange={(event) => {
              onTerme(event.target.value);
            }}
          />
        </label>
        {rechercheServeur === "indisponible" ? (
          <p className="mails-vide" role="status" data-testid="recherche-serveur-indisponible">
            {fr("Recherche du serveur indisponible : résultats de ce poste seulement.")}
          </p>
        ) : null}
        <div className="mails-filtres" role="group" aria-label={fr("Filtrer la liste")}>
          <h2 data-testid="liste-titre">{fr(titre)}</h2>
          {FILTRES.map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid="filtre-mails"
              data-filtre={option.id}
              aria-pressed={filtre === option.id}
              onClick={() => {
                onFiltre(option.id);
              }}
            >
              {fr(option.libelle)}
            </button>
          ))}
        </div>
      </div>
      <div
        className="mails-liste__corps"
        data-testid={enRecherche ? "recherche-mails-resultats" : "mails-liste-corps"}
      >
        {vide ? <p className="mails-vide">{fr(messageVide)}</p> : null}
        {groupes.map((groupe) => (
          <div key={groupe.cle} data-testid="groupe-jour" data-groupe={groupe.cle}>
            <div className="mails-groupe">{fr(groupe.titre)}</div>
            <ul>
              {groupe.mails.map((mail) => (
                <li
                  key={mail.id}
                  data-testid={enRecherche ? "recherche-mail-hit" : undefined}
                  data-id={enRecherche ? mail.id : undefined}
                >
                  <LigneMail
                    mail={mail}
                    choisie={selection === mail.id}
                    onSelection={onSelection}
                    dossiers={dossiers}
                    classeLocal={classesLocal[mail.id]}
                    maintenant={maintenant}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

type LigneMailProps = {
  mail: MailLocal;
  choisie: boolean;
  onSelection: (id: string) => void;
  dossiers: ReadonlyMap<string, DossierClassement>;
  classeLocal: string | undefined;
  maintenant: Date;
};

function LigneMail({ mail, choisie, onSelection, dossiers, classeLocal, maintenant }: LigneMailProps) {
  const expediteur = analyserCorrespondant(mail.expediteur);
  const nom = mail.brouillon === true ? nomLigneBrouillon(mail.destinataires_texte ?? "") : nomAffiche(expediteur);
  const apercu = apercuMail(mail);
  const pieces = listePieces(mail).length > 0;
  const lu = estLu(mail);
  const classe = mail.etat_classement === "classe" || classeLocal !== undefined;
  const dossierId = classeLocal ?? mail.dossier_id;
  const dossier = classe && dossierId !== null ? dossiers.get(dossierId) : undefined;
  return (
    <button
      type="button"
      className="mails-ligne"
      data-testid="mail-ligne"
      data-id={mail.id}
      data-etat={mail.etat_classement ?? ""}
      data-lu={lu ? "true" : "false"}
      aria-current={choisie}
      onClick={() => {
        onSelection(mail.id);
      }}
    >
      <span className="mails-mono" aria-hidden>
        {mail.brouillon === true ? <IconPencil stroke={1.6} size={15} /> : monogramme(expediteur)}
      </span>
      <span className="mails-ligne__texte">
        <span className="mails-ligne__exp">{fr(nom === "" ? "—" : nom)}</span>
        <span className="mails-ligne__obj">{fr(mail.objet?.trim() || "(sans objet)")}</span>
        {apercu !== "" ? <span className="mails-ligne__ext">{fr(apercu)}</span> : null}
      </span>
      <span className="mails-ligne__droite">
        <span className="mails-ligne__quand">
          {pieces ? <IconPaperclip stroke={1.6} aria-label={fr("Pièce jointe")} role="img" /> : null}
          {horodatageListe(dateDuMail(mail), maintenant)}
          {lu ? null : <span className="mails-nonlu" role="img" aria-label={fr("Non lu")} />}
        </span>
        {dossier ? (
          <span className="mails-dos" data-chemise={dossier.chemise}>
            <i data-testid="pastille-mail" aria-hidden />
            {fr(etiquetteDossier(dossier))}
          </span>
        ) : classe ? null : estAClasser(mail.etat_classement) ? (
          <span className="mails-aclasser" data-testid="etiquette-a-classer">
            {fr("À classer")}
          </span>
        ) : null}
      </span>
    </button>
  );
}
