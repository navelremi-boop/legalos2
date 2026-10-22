//! Dossiers IMAP d'une boîte (J11, consigne de l'architecte du 20/10/2026) : la liste que l'écran Mails propose à
//! « Déplacer vers… », avec les noms français des dossiers spéciaux quel que soit le nom du serveur.
//!
//! Droits : la boîte doit être lisible par l'utilisateur (`compte_mail_lisible_par`), sinon elle est introuvable
//! (404), pas interdite. La liste est lue sur le serveur IMAP à chaque demande : rien d'un dossier n'est gardé.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use legalos_messagerie::{ErreurMail, SessionActions};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::routes::redaction::parametres_imap_depuis;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct DossierImapResponse {
    /// Nom IMAP exact, à présenter tel quel pour déplacer un message.
    pub nom: String,
    /// Nom affiché : français pour un dossier spécial, sinon le chemin avec « / ».
    pub libelle: String,
    /// `reception`, `brouillons`, `envoyes`, `archives`, `corbeille`, `indesirables` ; absent pour un dossier ordinaire.
    pub role: Option<String>,
    /// Faux pour Archives ou Corbeille quand le serveur n'en a pas : ils seront créés au premier déplacement.
    pub existe: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DossiersImapResponse {
    pub dossiers: Vec<DossierImapResponse>,
}

/// Dossiers où l'on peut ranger un message de cette boîte.
#[utoipa::path(
    get,
    path = "/messagerie/comptes/{compte_id}/dossiers",
    tag = "messagerie",
    security(("bearer_auth" = [])),
    params(("compte_id" = Uuid, Path, description = "Boîte lisible par l'utilisateur")),
    responses(
        (status = 200, description = "Dossiers de la boîte, spéciaux d'abord", body = DossiersImapResponse),
        (status = 404, description = "Boîte introuvable ou non lisible par l'utilisateur", body = crate::error::ApiErrorBody),
        (status = 409, description = "Le fournisseur a refusé les identifiants : reconnecter la boîte", body = crate::error::ApiErrorBody),
        (status = 502, description = "Serveur de messagerie injoignable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lister_dossiers_imap(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Path(compte_id): Path<Uuid>,
) -> Result<Json<DossiersImapResponse>, ApiError> {
    let ligne = sqlx::query_as::<_, (String, Option<bool>)>(
        r#"
        SELECT type_compte, compte_mail_lisible_par(id, $3)
        FROM comptes_mail
        WHERE id = $1 AND cabinet_id = $2
        "#,
    )
    .bind(compte_id)
    .bind(claims.cabinet_id)
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture de la boîte"))?;
    let type_compte = match ligne {
        Some((type_compte, Some(true))) => type_compte,
        _ => return Err(ApiError::not_found("Boîte introuvable")),
    };
    let parametres = parametres_imap_depuis(
        &state.pool,
        &state.totp_cipher_key,
        state.messagerie.as_ref(),
        compte_id,
        &type_compte,
    )
    .await?;
    let dossiers = tokio::task::spawn_blocking(move || {
        let mut session = SessionActions::connecter(&parametres)?;
        session.dossiers_presentes()
    })
    .await
    .map_err(|_| ApiError::internal("Lecture interrompue"))?
    .map_err(|erreur| match erreur {
        ErreurMail::Authentification => ApiError::conflict(
            "Le serveur de messagerie a refusé les identifiants de cette boîte : reconnectez-la depuis Réglages.",
        ),
        _ => ApiError::with_code(
            StatusCode::BAD_GATEWAY,
            "serveur_messagerie_injoignable",
            "Le serveur de messagerie ne répond pas, réessayez dans un instant.",
        ),
    })?;
    Ok(Json(DossiersImapResponse {
        dossiers: dossiers
            .into_iter()
            .map(|d| DossierImapResponse {
                nom: d.nom,
                libelle: d.libelle,
                role: d.role.map(|r| r.texte().to_owned()),
                existe: d.existe,
            })
            .collect(),
    }))
}
