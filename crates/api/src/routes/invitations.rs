//! Invitations de calendrier reçues par mail (J11, étape 2) : lecture et réponse du titulaire.
//!
//! La relève crée les lignes (`crate::invitations`) ; le poste les lit par le flux
//! `invitations_titulaire`. Ces deux routes servent aux clients sans synchronisation et à la
//! recette. Une invitation n'est jamais visible ni répondable par un autre collaborateur : la
//! ligne d'un autre titulaire est « introuvable ».
//!
//! **Agenda du titulaire** : `invitations_agenda` est la source de l'écran Agenda. Aucun élément
//! d'`agenda_elements` n'est créé, car cette table exige un dossier (`dossier_id NOT NULL`) et
//! les invitations n'en ont pas.
//!
//! La réponse iTIP (`METHOD:REPLY`) part vers l'organisateur par la file d'envoi existante :
//! identifiant de message généré une seule fois, copie dans « Envoyés » confirmée, reprise sûre.
//! Aucun objet ni adresse dans les journaux.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    Json,
};
use legalos_messagerie::{
    champ_en_tete_valide, invitation_depuis_stockage, reponse_invitation, InvitationStockee,
    PieceJointe, ReponseInvitation,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::jwt::AccessClaims;
use crate::error::ApiError;
use crate::identite_envoi::identite_pour_utilisateur;
use crate::routes::file_envoi::traiter;
use crate::routes::redaction::{
    nouvel_identifiant, sortant_depuis_contenu, texte_depuis_liste, ContenuEnvoi, OBJET_MAX,
};
use crate::state::AppState;

/// Type de la partie calendrier de la réponse (RFC 6047 § 2.4 : `method` du `Content-Type`).
const TYPE_REPONSE_ITIP: &str = "text/calendar; method=REPLY; charset=utf-8";

macro_rules! colonnes {
    () => {
        "i.id, i.uid_ical, i.sequence, i.effet, i.fuseau, i.debut, i.fin, i.debut_utc, \
         i.fin_utc, i.objet, i.organisateur, i.verifiee, i.message_id, i.compte_id, i.reponse, \
         to_char(i.repondu_le AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') \
             AS repondu_le, \
         i.reponse_envoi_id, i.revision, \
         (SELECT f.etat FROM file_envoi f WHERE f.id = i.reponse_envoi_id) AS envoi_etat"
    };
}

#[derive(Debug, sqlx::FromRow)]
struct LigneInvitation {
    id: Uuid,
    uid_ical: String,
    sequence: i32,
    effet: String,
    fuseau: String,
    debut: String,
    fin: Option<String>,
    debut_utc: Option<String>,
    fin_utc: Option<String>,
    objet: String,
    organisateur: String,
    verifiee: bool,
    message_id: Option<String>,
    compte_id: Option<Uuid>,
    reponse: Option<String>,
    repondu_le: Option<String>,
    reponse_envoi_id: Option<Uuid>,
    revision: i64,
    envoi_etat: Option<String>,
}

/// Invitation du titulaire, telle que l'agenda l'affiche.
#[derive(Debug, Serialize, ToSchema)]
pub struct InvitationResponse {
    pub id: Uuid,
    pub uid_ical: String,
    pub sequence: i32,
    /// `demande`, `mise_a_jour` ou `annulation` (la ligne reste, marquée annulée).
    pub effet: String,
    /// Fuseau annoncé par l'organisateur (nom IANA, `UTC` ou `flottant`).
    pub fuseau: String,
    /// Heure civile du fuseau annoncé : `2026-10-06T09:00:00`, ou `2026-10-06` (journée entière).
    pub debut: String,
    pub fin: Option<String>,
    /// Instant UTC déduit (`2026-10-06T07:00:00.000Z`) ; absent pour une heure flottante, une
    /// journée entière ou un fuseau inconnu.
    pub debut_utc: Option<String>,
    pub fin_utc: Option<String>,
    pub objet: String,
    pub organisateur: String,
    /// Le mail qui la porte vient de l'organisateur annoncé. `false` : origine non confirmée, à
    /// afficher comme telle.
    pub verifiee: bool,
    /// `Message-ID` du message qui porte (la dernière version de) l'invitation.
    pub message_id: Option<String>,
    /// `accepte`, `refuse` ou `peut_etre` ; absent tant que le titulaire n'a pas répondu à cette
    /// version.
    pub reponse: Option<String>,
    pub repondu_le: Option<String>,
    /// État de l'envoi de la réponse dans la file d'envoi (`copie_envoyes_confirmee` une fois
    /// la copie dans « Envoyés » confirmée).
    pub envoi_etat: Option<String>,
    pub revision: i64,
}

impl From<LigneInvitation> for InvitationResponse {
    fn from(ligne: LigneInvitation) -> Self {
        Self {
            id: ligne.id,
            uid_ical: ligne.uid_ical,
            sequence: ligne.sequence,
            effet: ligne.effet,
            fuseau: ligne.fuseau,
            debut: ligne.debut,
            fin: ligne.fin,
            debut_utc: ligne.debut_utc,
            fin_utc: ligne.fin_utc,
            objet: ligne.objet,
            organisateur: ligne.organisateur,
            verifiee: ligne.verifiee,
            message_id: ligne.message_id,
            reponse: ligne.reponse,
            repondu_le: ligne.repondu_le,
            envoi_etat: ligne.envoi_etat,
            revision: ligne.revision,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReponseInvitationRequest {
    /// `accepter`, `refuser` ou `peut_etre`.
    pub reponse: String,
}

/// Réponse choisie par le titulaire, et ce qu'elle devient dans l'e-mail et la base.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Choix {
    Accepter,
    Refuser,
    PeutEtre,
}

impl Choix {
    pub fn depuis_texte(texte: &str) -> Option<Self> {
        match texte {
            "accepter" => Some(Self::Accepter),
            "refuser" => Some(Self::Refuser),
            "peut_etre" => Some(Self::PeutEtre),
            _ => None,
        }
    }

    /// État gardé dans `invitations_agenda.reponse`.
    pub fn etat(self) -> &'static str {
        match self {
            Self::Accepter => "accepte",
            Self::Refuser => "refuse",
            Self::PeutEtre => "peut_etre",
        }
    }

    fn itip(self) -> ReponseInvitation {
        match self {
            Self::Accepter => ReponseInvitation::Accepter,
            Self::Refuser => ReponseInvitation::Refuser,
            Self::PeutEtre => ReponseInvitation::PeutEtre,
        }
    }

    fn prefixe_objet(self) -> &'static str {
        match self {
            Self::Accepter => "Accepté",
            Self::Refuser => "Refusé",
            Self::PeutEtre => "Peut-être",
        }
    }

    fn formule(self) -> &'static str {
        match self {
            Self::Accepter => "accepte",
            Self::Refuser => "refuse",
            Self::PeutEtre => "répond peut-être à",
        }
    }
}

/// Objet de la réponse : « Accepté : objet de l'invitation », sans caractère de contrôle ni
/// dépassement de la longueur permise.
pub fn objet_de_reponse(choix: Choix, objet_invitation: &str) -> String {
    let propre: String = objet_invitation
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let objet = format!("{} : {}", choix.prefixe_objet(), propre.trim());
    objet.chars().take(OBJET_MAX).collect()
}

fn corps_de_reponse(choix: Choix) -> String {
    format!("Le destinataire {} l'invitation jointe.", choix.formule())
}

async fn charger(
    state: &AppState,
    claims: &AccessClaims,
    id: Uuid,
) -> Result<LigneInvitation, ApiError> {
    sqlx::query_as::<_, LigneInvitation>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM invitations_agenda i WHERE i.id = $1 AND i.cabinet_id = $2 AND i.titulaire_id = $3"
    ))
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture de l'invitation"))?
    .ok_or_else(|| ApiError::not_found("Invitation introuvable"))
}

/// Invitations reçues par les boîtes nominatives du titulaire, de la plus proche à la plus
/// lointaine.
#[utoipa::path(
    get,
    path = "/messagerie/invitations",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Invitations du titulaire (jamais celles d'un autre collaborateur)", body = [InvitationResponse]),
    )
)]
pub async fn lister_invitations(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<InvitationResponse>>, ApiError> {
    let lignes = sqlx::query_as::<_, LigneInvitation>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM invitations_agenda i WHERE i.cabinet_id = $1 AND i.titulaire_id = $2 \
         ORDER BY COALESCE(i.debut_utc, i.debut), i.uid_ical"
    ))
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des invitations"))?;
    Ok(Json(lignes.into_iter().map(Into::into).collect()))
}

/// Répond à une invitation : la réponse iTIP (`METHOD:REPLY`, `PARTSTAT` accepté, refusé ou
/// provisoire) part vers l'organisateur par la file d'envoi. Une autre réponse remplace la
/// première et renvoie une réponse ; la même réponse rejouée n'en renvoie pas de seconde (elle
/// reprend seulement un envoi resté en attente ou en échec).
#[utoipa::path(
    post,
    path = "/messagerie/invitations/{id}/reponse",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    request_body = ReponseInvitationRequest,
    responses(
        (status = 200, description = "Invitation avec la réponse enregistrée et l'état de son envoi", body = InvitationResponse),
        (status = 400, description = "Réponse inconnue ou messagerie non configurée", body = crate::error::ApiErrorBody),
        (status = 404, description = "Invitation introuvable ou d'un autre titulaire", body = crate::error::ApiErrorBody),
        (status = 409, description = "Invitation annulée par l'organisateur", body = crate::error::ApiErrorBody),
    )
)]
pub async fn repondre_invitation(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(id): Path<Uuid>,
    Json(corps): Json<ReponseInvitationRequest>,
) -> Result<Json<InvitationResponse>, ApiError> {
    let choix = Choix::depuis_texte(&corps.reponse).ok_or_else(|| {
        ApiError::bad_request("Réponse inconnue : accepter, refuser ou peut_etre")
    })?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Réponse à l'invitation"))?;
    // La ligne est verrouillée : deux réponses simultanées se suivent, la seconde voit la première.
    let ligne = sqlx::query_as::<_, LigneInvitation>(concat!(
        "SELECT ",
        colonnes!(),
        " FROM invitations_agenda i WHERE i.id = $1 AND i.cabinet_id = $2 AND i.titulaire_id = $3 \
         FOR UPDATE OF i"
    ))
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Lecture de l'invitation"))?
    .ok_or_else(|| ApiError::not_found("Invitation introuvable"))?;

    if ligne.effet == "annulation" {
        return Err(ApiError::conflict(
            "Cette invitation a été annulée par l'organisateur : elle ne peut plus recevoir de réponse.",
        ));
    }

    // Même réponse que la précédente : aucun nouvel envoi. On reprend seulement l'envoi déjà
    // créé s'il n'est pas terminé (réseau coupé, échec) ; « Envoyés » est lu avant tout renvoi.
    if ligne.reponse.as_deref() == Some(choix.etat()) {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Réponse à l'invitation"))?;
        if let Some(envoi) = ligne.reponse_envoi_id {
            if ligne.envoi_etat.as_deref() != Some("copie_envoyes_confirmee") {
                reprendre(&state, &claims, envoi).await;
            }
        }
        return Ok(Json(charger(&state, &claims, id).await?.into()));
    }

    let compte_file = match ligne.compte_id {
        Some(compte_id) => sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM comptes_mail WHERE id = $1 AND titulaire_id = $2",
        )
        .bind(compte_id)
        .bind(claims.sub)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Lecture de la boîte"))?,
        None => None,
    }
    .ok_or_else(|| {
        ApiError::conflict(
            "La boîte qui a reçu cette invitation n'existe plus : réponse impossible.",
        )
    })?;
    // La réponse part de la boîte qui a reçu l'invitation, donc de l'adresse invitée (ATTENDEE),
    // avec le relais SMTP de cette boîte, et sa copie va dans les envoyés de cette boîte : jamais
    // de l'adresse du cabinet (un organisateur Exchange ignorerait une réponse venue d'ailleurs).
    let identite = identite_pour_utilisateur(&state, &claims, compte_file).await?;
    let adresse_compte = identite.de.clone();
    if !champ_en_tete_valide(&ligne.organisateur) || ligne.organisateur.trim().is_empty() {
        return Err(ApiError::conflict(
            "L'adresse de l'organisateur est illisible : réponse impossible.",
        ));
    }

    let invitation = invitation_depuis_stockage(&InvitationStockee {
        uid: &ligne.uid_ical,
        sequence: u32::try_from(ligne.sequence).unwrap_or(0),
        fuseau: &ligne.fuseau,
        debut: &ligne.debut,
        fin: ligne.fin.as_deref(),
        objet: &ligne.objet,
        organisateur: &ligne.organisateur,
    })
    .map_err(|_| ApiError::internal("Invitation illisible"))?;
    let ical = reponse_invitation(&invitation, &adresse_compte, choix.itip())
        .map_err(|_| ApiError::internal("Construction de la réponse"))?;

    let envoi_id = Uuid::now_v7();
    let message_id = nouvel_identifiant(&identite.de);
    let fil = ligne.message_id.clone().filter(|m| !m.trim().is_empty());
    let contenu = ContenuEnvoi {
        message_id: message_id.clone(),
        a: vec![ligne.organisateur.trim().to_owned()],
        cc: Vec::new(),
        cci: Vec::new(),
        objet: objet_de_reponse(choix, &ligne.objet),
        corps: corps_de_reponse(choix),
        corps_html: String::new(),
        en_reponse_a: fil.clone(),
        references: fil.iter().cloned().collect(),
        repondre_a: identite.repondre_a.clone(),
        pieces: vec![PieceJointe {
            nom: "reponse.ics".to_owned(),
            type_mime: TYPE_REPONSE_ITIP.to_owned(),
            contenu: ical.into_bytes(),
        }],
    };
    // Construction à blanc : adresse et en-têtes validés avant tout effet.
    sortant_depuis_contenu(&identite.de, &contenu).map_err(|_| {
        ApiError::conflict("L'adresse de l'organisateur est illisible : réponse impossible.")
    })?;

    sqlx::query(
        r#"
        INSERT INTO file_envoi (
            id, cabinet_id, compte_id, dossier_id, message_id,
            destinataire, cc, cci, objet, corps, corps_html,
            genre, origine_message_id, en_reponse_a, references_texte,
            auteur_id, etat, tentatives
        ) VALUES ($1,$2,$3,NULL,$4,$5,'','',$6,$7,'','nouveau',NULL,$8,$9,$10,'en_attente',0)
        "#,
    )
    .bind(envoi_id)
    .bind(claims.cabinet_id)
    .bind(compte_file)
    .bind(&message_id)
    .bind(texte_depuis_liste(&contenu.a))
    .bind(&contenu.objet)
    .bind(&contenu.corps)
    .bind(&fil)
    .bind(texte_depuis_liste(&contenu.references))
    .bind(claims.sub)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Création de l'envoi de la réponse"))?;
    for (ordre, piece) in contenu.pieces.iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO file_envoi_pieces (id, envoi_id, ordre, nom, type_mime, contenu)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(envoi_id)
        .bind(i32::try_from(ordre).unwrap_or(i32::MAX))
        .bind(&piece.nom)
        .bind(&piece.type_mime)
        .bind(&piece.contenu)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("Enregistrement de la réponse"))?;
    }
    sqlx::query(
        r#"
        UPDATE invitations_agenda
        SET reponse = $2, repondu_le = NOW(), reponse_envoi_id = $3, revision = revision + 1
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(choix.etat())
    .bind(envoi_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("Enregistrement de la réponse"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Réponse à l'invitation"))?;

    reprendre(&state, &claims, envoi_id).await;
    Ok(Json(charger(&state, &claims, id).await?.into()))
}

/// Fait avancer l'envoi de la réponse jusqu'à la copie dans « Envoyés ». Un échec ne défait pas
/// la réponse : elle reste enregistrée, son envoi reste dans la file et se reprend (même appel,
/// ou route `/messagerie/file-envoi/{id}/traiter`).
async fn reprendre(state: &AppState, claims: &AccessClaims, envoi_id: Uuid) {
    if traiter(state, claims, envoi_id, false, false)
        .await
        .is_err()
    {
        tracing::warn!(envoi = %envoi_id, "envoi de la réponse à l'invitation reporté");
    }
}

#[cfg(test)]
mod tests {
    use super::{objet_de_reponse, Choix};

    #[test]
    fn les_trois_reponses_et_leurs_etats() {
        assert_eq!(
            Choix::depuis_texte("accepter").map(Choix::etat),
            Some("accepte")
        );
        assert_eq!(
            Choix::depuis_texte("refuser").map(Choix::etat),
            Some("refuse")
        );
        assert_eq!(
            Choix::depuis_texte("peut_etre").map(Choix::etat),
            Some("peut_etre")
        );
        // Essais négatifs : ni l'état stocké, ni une autre casse, ni le vide.
        for mauvais in ["accepte", "Accepter", "", "oui", "accepter "] {
            assert_eq!(Choix::depuis_texte(mauvais), None, "{mauvais:?} accepté");
        }
    }

    #[test]
    fn l_objet_de_la_reponse_n_a_ni_retour_a_la_ligne_ni_depassement() {
        assert_eq!(
            objet_de_reponse(Choix::Accepter, "Audience fictive"),
            "Accepté : Audience fictive"
        );
        assert_eq!(
            objet_de_reponse(Choix::Refuser, "Audience\r\nBcc: x@example.com"),
            "Refusé : Audience  Bcc: x@example.com"
        );
        assert!(objet_de_reponse(Choix::PeutEtre, "x").starts_with("Peut-être : "));
        let long = "é".repeat(1000);
        assert_eq!(
            objet_de_reponse(Choix::Accepter, &long).chars().count(),
            super::OBJET_MAX
        );
    }
}
