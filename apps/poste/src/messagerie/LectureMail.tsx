import { useState } from "react";
import {
  IconArrowBackUp,
  IconArrowBackUpDouble,
  IconArrowForwardUp,
  IconCheck,
  IconFolder,
  IconFolderPlus,
  IconInbox,
} from "@tabler/icons-react";
import { fr } from "@/lib/fr";
import {
  encartClassement,
  etiquetteDossier,
  type DossierClassement,
  type EncartClassement,
} from "@/messagerie/classement";
import {
  analyserCorrespondant,
  destinatairesAffiches,
  monogramme,
  nomAffiche,
} from "@/messagerie/expediteurs";
import { presenterInvitation } from "@/messagerie/invitations";
import {
  extensionPiece,
  horodatageLecture,
  listePieces,
  paragraphes,
} from "@/messagerie/listeMails";
import { REPONSES_INVITATION, type ReponseInvitation } from "@/messagerie/reponseInvitation";
import type { InvitationLocale, MailLocal } from "@/messagerie/typesMails";

/** Ce que l'utilisateur demande à la rédaction (branchée par la partie B de l'étape 4). */
export type GenreComposition = "nouveau" | "repondre" | "repondre-a-tous" | "transferer";
export type DemandeComposition = { genre: GenreComposition; messageId?: string };

type LectureMailProps = {
  mail: MailLocal;
  maintenant: Date;
  adressesPropres: readonly string[];
  /** Texte du message : `undefined` tant qu'il se charge, chaîne vide s'il n'est pas disponible. */
  corps: string | undefined;
  dossiers: ReadonlyMap<string, DossierClassement>;
  /** Dossier choisi par l'utilisateur, la synchronisation n'ayant pas encore rendu l'état classé. */
  classeLocal: string | undefined;
  erreurClassement: string | null;
  onClasser: (dossierId: string) => void;
  invitation: InvitationLocale | null;
  reponseConfirmee: ReponseInvitation | undefined;
  erreurInvitation: string | null;
  reponseEnCours: boolean;
  onRepondreInvitation: (invitationId: string, reponse: ReponseInvitation) => void;
  onComposer?: (demande: DemandeComposition) => void;
};

function libelleDossier(dossier: DossierClassement): string {
  const reference = etiquetteDossier(dossier);
  return reference === dossier.nom ? dossier.nom : `${reference}, ${dossier.nom}`;
}

/** Volet de droite : en-tête, actions, encart de classement, invitation, corps, pièces jointes. */
export function LectureMail({
  mail,
  maintenant,
  adressesPropres,
  corps,
  dossiers,
  classeLocal,
  erreurClassement,
  onClasser,
  invitation,
  reponseConfirmee,
  erreurInvitation,
  reponseEnCours,
  onRepondreInvitation,
  onComposer,
}: LectureMailProps) {
  const [choixOuvert, setChoixOuvert] = useState(false);
  const [cible, setCible] = useState("");
  const expediteur = analyserCorrespondant(mail.expediteur);
  const destinataires = destinatairesAffiches(mail.destinataires_texte, adressesPropres);
  const encart = encartClassement(mail, dossiers, classeLocal);
  const pieces = listePieces(mail);
  const invitationPresentee = invitation === null ? null : presenterInvitation(invitation);
  const dossiersTries = [...dossiers.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const chemiseInvitation = encart.genre === "classe" ? encart.dossier?.chemise : undefined;

  const composer = (genre: GenreComposition) => {
    onComposer?.({ genre, messageId: mail.id });
  };

  return (
    <section className="mails-lecture" data-testid="mails-lecture" aria-live="polite">
      <div className="mails-lecture__tete">
        <span className="mails-mono mails-mono--lecture" aria-hidden>
          {monogramme(expediteur)}
        </span>
        <div className="mails-lecture__qui">
          <b data-testid="lecture-expediteur">{fr(nomAffiche(expediteur) || "—")}</b>
          {expediteur.nom !== "" && expediteur.adresse !== "" ? (
            <span data-testid="lecture-adresse">{expediteur.adresse}</span>
          ) : null}
          <span data-testid="lecture-destinataires">{fr(destinataires === "" ? "—" : `À ${destinataires}`)}</span>
        </div>
        <span className="mails-lecture__quand" data-testid="lecture-date">
          {fr(horodatageLecture(mail.cree_le, maintenant) || "—")}
        </span>
      </div>

      <h2 className="mails-lecture__titre" data-testid="lecture-objet">
        {fr(mail.objet?.trim() || "(sans objet)")}
      </h2>

      <div className="mails-actions">
        <button
          type="button"
          className="mails-act"
          data-testid="lecture-repondre"
          onClick={() => {
            composer("repondre");
          }}
        >
          <IconArrowBackUp stroke={1.7} aria-hidden />
          {fr("Répondre")}
        </button>
        <button
          type="button"
          className="mails-act"
          data-testid="lecture-repondre-a-tous"
          onClick={() => {
            composer("repondre-a-tous");
          }}
        >
          <IconArrowBackUpDouble stroke={1.7} aria-hidden />
          {fr("Répondre à tous")}
        </button>
        <button
          type="button"
          className="mails-act"
          data-testid="lecture-transferer"
          onClick={() => {
            composer("transferer");
          }}
        >
          <IconArrowForwardUp stroke={1.7} aria-hidden />
          {fr("Transférer")}
        </button>
      </div>

      <EncartDeClassement
        encart={encart}
        animer={classeLocal !== undefined}
        choixOuvert={choixOuvert}
        onChoix={setChoixOuvert}
        cible={cible}
        onCible={setCible}
        dossiers={dossiersTries}
        onClasser={onClasser}
      />
      {erreurClassement !== null ? (
        <p className="mails-erreur" role="alert" data-testid="classement-erreur">
          {fr(erreurClassement)}
        </p>
      ) : null}

      {invitationPresentee !== null && invitation !== null ? (
        <div
          className="mails-invit"
          data-testid="carte-invitation"
          data-chemise={chemiseInvitation}
          data-effet={invitation.effet}
        >
          <div className="mails-cal" aria-hidden>
            <span>{fr(invitationPresentee.mois)}</span>
            <b>{invitationPresentee.jour}</b>
          </div>
          <div>
            {invitationPresentee.annulee ? (
              <p className="mails-invit__etat" data-testid="invitation-etat">
                {fr("Invitation annulée")}
              </p>
            ) : invitationPresentee.miseAJour ? (
              <p className="mails-invit__etat" data-testid="invitation-etat">
                {fr("Invitation mise à jour")}
              </p>
            ) : null}
            <h3 data-testid="invitation-titre">{fr(invitationPresentee.titre)}</h3>
            <p data-testid="invitation-quand">{fr(invitationPresentee.quand)}</p>
            {invitationPresentee.organisateur !== "" ? (
              <p data-testid="invitation-organisateur">{fr(invitationPresentee.organisateur)}</p>
            ) : null}
            {invitationPresentee.annulee ? null : (
              <div className="mails-rep" role="group" aria-label={fr("Répondre à l'invitation")}>
                {REPONSES_INVITATION.map((option) => (
                  <button
                    key={option.reponse}
                    type="button"
                    data-testid="invitation-repondre"
                    data-reponse={option.reponse}
                    aria-pressed={reponseConfirmee === option.reponse}
                    disabled={reponseEnCours}
                    onClick={() => {
                      onRepondreInvitation(invitation.id, option.reponse);
                    }}
                  >
                    {fr(option.libelle)}
                  </button>
                ))}
              </div>
            )}
            {reponseConfirmee !== undefined ? (
              <p className="mails-invit__etat" role="status" data-testid="invitation-confirmee">
                {fr(
                  reponseConfirmee === "refuser"
                    ? "Refus envoyé à l'organisateur."
                    : "Réponse envoyée à l'organisateur.",
                )}
                <IconCheck stroke={2} aria-hidden size={14} />
              </p>
            ) : null}
            {erreurInvitation !== null ? (
              <p className="mails-erreur" role="alert" data-testid="invitation-erreur">
                {fr(erreurInvitation)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mails-corps" data-testid="lecture-corps">
        {corps === undefined ? null : paragraphes(corps).length === 0 ? (
          <p>{fr("Le texte de ce message n'est pas disponible pour le moment.")}</p>
        ) : (
          paragraphes(corps).map((paragraphe, index) => <p key={`${String(index)}-${paragraphe.slice(0, 12)}`}>{fr(paragraphe)}</p>)
        )}
      </div>

      {pieces.length > 0 ? (
        <div className="mails-pj" data-testid="lecture-pieces">
          {pieces.map((piece, index) => {
            const extension = extensionPiece(piece);
            return (
              <span key={`${piece}-${String(index)}`} className="mails-fichier" data-testid="lecture-piece">
                {extension === "" ? null : <i>{extension}</i>}
                {fr(piece)}
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

type EncartDeClassementProps = {
  encart: EncartClassement;
  animer: boolean;
  choixOuvert: boolean;
  onChoix: (ouvert: boolean) => void;
  cible: string;
  onCible: (id: string) => void;
  dossiers: DossierClassement[];
  onClasser: (dossierId: string) => void;
};

function EncartDeClassement({
  encart,
  animer,
  choixOuvert,
  onChoix,
  cible,
  onCible,
  dossiers,
  onClasser,
}: EncartDeClassementProps) {
  if (encart.genre === "classe") {
    return (
      <div
        className={animer ? "mails-encart mails-encart--classe" : "mails-encart"}
        data-testid="encart-classe"
        data-chemise={encart.dossier?.chemise}
      >
        <IconFolder stroke={1.6} aria-hidden />
        <div className="mails-encart__corps">
          <b data-testid="encart-classe-titre">
            {fr(encart.dossier === null ? "Classé dans un dossier" : `Classé dans ${libelleDossier(encart.dossier)}`)}
          </b>
        </div>
      </div>
    );
  }

  const suggestion = encart.genre === "suggestion";
  const titre = suggestion
    ? encart.dossier === null
      ? "Classer dans le dossier suggéré ?"
      : `Classer dans ${etiquetteDossier(encart.dossier)} ?`
    : "Hors dossier";
  const detail = suggestion
    ? (encart.dossier?.nom ?? "")
    : "Ce mail ne concerne aucun dossier pour l'instant. Choisissez-en un pour le ranger.";

  return (
    <div className="mails-encart" data-testid="banniere-classer" data-genre={encart.genre}>
      {suggestion ? <IconFolderPlus stroke={1.6} aria-hidden /> : <IconInbox stroke={1.6} aria-hidden />}
      <div className="mails-encart__corps">
        <b>{fr(titre)}</b>
        {detail === "" ? null : fr(detail)}
      </div>
      <div className="mails-encart__boutons">
        {choixOuvert ? (
          <>
            <select
              data-testid="classer-dossier"
              aria-label={fr("Dossier de classement")}
              value={cible}
              onChange={(event) => {
                onCible(event.target.value);
              }}
            >
              <option value="">{fr("Choisir un dossier")}</option>
              {dossiers.map((dossier) => (
                <option key={dossier.id} value={dossier.id}>
                  {fr(libelleDossier(dossier))}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-fort="true"
              data-testid="bouton-classer"
              disabled={cible === ""}
              onClick={() => {
                onClasser(cible);
              }}
            >
              {fr("Classer")}
            </button>
            <button
              type="button"
              onClick={() => {
                onChoix(false);
              }}
            >
              {fr("Annuler")}
            </button>
          </>
        ) : (
          <>
            {suggestion ? (
              <button
                type="button"
                data-fort="true"
                data-testid="bouton-classer"
                onClick={() => {
                  onClasser(encart.dossierId);
                }}
              >
                {fr("Classer")}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="bouton-autre-dossier"
              onClick={() => {
                onChoix(true);
              }}
            >
              {fr(suggestion ? "Autre dossier" : "Classer dans un dossier")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
