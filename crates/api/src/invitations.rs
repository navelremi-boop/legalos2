//! Invitations de calendrier reçues par mail (J11, étape 2), côté base.
//!
//! La relève du moteur appelle [`enregistrer_invitation`] pour un message d'une boîte
//! **nominative** seulement ; une boîte partagée ou de classement n'a pas de titulaire et ne crée
//! l'invitation de personne. Chaque ligne n'appartient qu'à son titulaire (flux PowerSync
//! `invitations_titulaire`, lecture `GET /messagerie/invitations`).
//!
//! Aucun objet, aucune adresse ni aucun contenu dans les journaux : identifiants techniques.

use legalos_messagerie::{
    decider_invitation, juger_origine, DecisionInvitation, EffetInvitation, InvitationConnue,
    InvitationLue, VerdictOrigine,
};
use sqlx::PgPool;
use uuid::Uuid;

/// Une invitation lue dans un message reçu par la boîte nominative d'un titulaire.
pub struct InvitationRecue<'a> {
    pub cabinet_id: Uuid,
    pub titulaire_id: Uuid,
    pub compte_id: Uuid,
    /// En-tête `Message-ID` du message porteur (même valeur que `messages.message_id`).
    pub message_id: &'a str,
    pub lue: &'a InvitationLue,
}

/// Ce que la relève a fait de l'invitation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueInvitation {
    Ignoree,
    /// Mise à jour ou annulation d'un autre expéditeur que l'organisateur enregistré, ou dont
    /// l'`ORGANIZER` diffère : aucun effet sur l'agenda.
    Refusee(VerdictOrigine),
    Creee,
    MiseAJour,
    Annulee,
}

pub fn effet_vers_texte(effet: EffetInvitation) -> &'static str {
    match effet {
        EffetInvitation::Demande => "demande",
        EffetInvitation::MiseAJour => "mise_a_jour",
        EffetInvitation::Annulation => "annulation",
    }
}

pub fn effet_depuis_texte(texte: &str) -> Option<EffetInvitation> {
    match texte {
        "demande" => Some(EffetInvitation::Demande),
        "mise_a_jour" => Some(EffetInvitation::MiseAJour),
        "annulation" => Some(EffetInvitation::Annulation),
        _ => None,
    }
}

/// Enregistre, met à jour ou ignore l'invitation, en une transaction. Clé : (titulaire, UID).
///
/// L'origine est jugée avant tout effet (`juger_origine`) : une mise à jour ou une annulation qui
/// ne vient pas de l'organisateur enregistré est refusée, une création dont l'expéditeur n'est
/// pas l'organisateur annoncé est enregistrée « non vérifiée ».
///
/// Un verrou consultatif sur la clé sérialise deux relèves concurrentes (deux boîtes du même
/// titulaire qui reçoivent la même invitation) : la SEQUENCE est lue puis écrite sans trou.
pub async fn enregistrer_invitation(
    pool: &PgPool,
    recue: &InvitationRecue<'_>,
) -> Result<IssueInvitation, sqlx::Error> {
    let lue = recue.lue;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("invitation:{}:{}", recue.titulaire_id, lue.uid))
        .execute(&mut *tx)
        .await?;
    let enregistree = sqlx::query_as::<_, (i32, String, String)>(
        "SELECT sequence, effet, organisateur FROM invitations_agenda WHERE titulaire_id = $1 AND uid_ical = $2",
    )
    .bind(recue.titulaire_id)
    .bind(&lue.uid)
    .fetch_optional(&mut *tx)
    .await?;
    let organisateur_connu = enregistree.as_ref().map(|(_, _, o)| o.clone());
    let connue = enregistree.and_then(|(sequence, effet, _)| {
        Some(InvitationConnue {
            sequence: u32::try_from(sequence).unwrap_or(0),
            effet: effet_depuis_texte(&effet)?,
        })
    });
    let decision = decider_invitation(connue, lue);
    let origine = juger_origine(decision, organisateur_connu.as_deref(), lue);
    if origine.refuse() {
        tx.commit().await?;
        return Ok(IssueInvitation::Refusee(origine));
    }
    let verifiee = origine == VerdictOrigine::Verifiee;
    let instants = lue.instants();
    let sequence = i32::try_from(lue.sequence).unwrap_or(i32::MAX);
    let issue = match decision {
        DecisionInvitation::Ignorer => IssueInvitation::Ignoree,
        DecisionInvitation::Creer => {
            sqlx::query(
                r#"
                INSERT INTO invitations_agenda (
                    id, cabinet_id, titulaire_id, uid_ical, sequence, effet, fuseau, debut, fin,
                    objet, organisateur, debut_utc, fin_utc, message_id, compte_id, verifiee
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                "#,
            )
            .bind(Uuid::now_v7())
            .bind(recue.cabinet_id)
            .bind(recue.titulaire_id)
            .bind(&lue.uid)
            .bind(sequence)
            .bind(effet_vers_texte(lue.effet))
            .bind(&lue.fuseau)
            .bind(&instants.debut_local)
            .bind(&instants.fin_local)
            .bind(&lue.objet)
            .bind(&lue.organisateur)
            .bind(&instants.debut_utc)
            .bind(&instants.fin_utc)
            .bind(recue.message_id)
            .bind(recue.compte_id)
            .bind(verifiee)
            .execute(&mut *tx)
            .await?;
            IssueInvitation::Creee
        }
        DecisionInvitation::MettreAJour => {
            // Une version plus récente remet la réponse à vide : il faut répondre à celle-ci.
            sqlx::query(
                r#"
                UPDATE invitations_agenda
                SET sequence = $3, effet = 'mise_a_jour', fuseau = $4, debut = $5, fin = $6,
                    objet = $7, organisateur = $8, debut_utc = $9, fin_utc = $10,
                    message_id = $11, compte_id = $12, verifiee = TRUE,
                    reponse = NULL, repondu_le = NULL, reponse_envoi_id = NULL,
                    revision = revision + 1
                WHERE titulaire_id = $1 AND uid_ical = $2
                "#,
            )
            .bind(recue.titulaire_id)
            .bind(&lue.uid)
            .bind(sequence)
            .bind(&lue.fuseau)
            .bind(&instants.debut_local)
            .bind(&instants.fin_local)
            .bind(&lue.objet)
            .bind(&lue.organisateur)
            .bind(&instants.debut_utc)
            .bind(&instants.fin_utc)
            .bind(recue.message_id)
            .bind(recue.compte_id)
            .execute(&mut *tx)
            .await?;
            IssueInvitation::MiseAJour
        }
        DecisionInvitation::Annuler => {
            // La ligne reste, marquée annulée, avec son contenu et la réponse déjà donnée.
            sqlx::query(
                r#"
                UPDATE invitations_agenda
                SET effet = 'annulation', sequence = GREATEST(sequence, $3), message_id = $4,
                    revision = revision + 1
                WHERE titulaire_id = $1 AND uid_ical = $2
                "#,
            )
            .bind(recue.titulaire_id)
            .bind(&lue.uid)
            .bind(sequence)
            .bind(recue.message_id)
            .execute(&mut *tx)
            .await?;
            IssueInvitation::Annulee
        }
    };
    tx.commit().await?;
    Ok(issue)
}

#[cfg(test)]
mod tests {
    use super::{effet_depuis_texte, effet_vers_texte};
    use legalos_messagerie::EffetInvitation;

    #[test]
    fn les_trois_effets_font_l_aller_retour_et_un_inconnu_est_refuse() {
        for effet in [
            EffetInvitation::Demande,
            EffetInvitation::MiseAJour,
            EffetInvitation::Annulation,
        ] {
            assert_eq!(effet_depuis_texte(effet_vers_texte(effet)), Some(effet));
        }
        assert_eq!(effet_depuis_texte("supprimee"), None);
    }
}
