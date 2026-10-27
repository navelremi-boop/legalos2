use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::auth::password::hash_password;
use crate::auth::totp::chiffrer_secret_totp;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerCollaborateurRequest {
    pub email: String,
    pub password: String,
    pub totp_secret_base32: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CollaborateurResponse {
    pub id: Uuid,
    pub email: String,
    /// `administrateur` ou `collaborateur`.
    pub role: String,
}

/// Rôle d'un utilisateur du cabinet de l'appelant ; `None` si l'utilisateur n'existe pas dans ce cabinet.
pub async fn role_de(
    pool: &sqlx::PgPool,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
) -> Result<Option<String>, ApiError> {
    sqlx::query_scalar::<_, String>(
        "SELECT role FROM utilisateurs WHERE id = $1 AND cabinet_id = $2 AND actif",
    )
    .bind(utilisateur_id)
    .bind(cabinet_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Lecture du rôle"))
}

/// Vrai si l'appelant est administrateur de son cabinet.
pub async fn est_administrateur(
    pool: &sqlx::PgPool,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
) -> Result<bool, ApiError> {
    Ok(role_de(pool, cabinet_id, utilisateur_id).await?.as_deref() == Some("administrateur"))
}

/// Action réservée aux administrateurs : 403 (la ressource est visible, l'action est interdite).
pub async fn exiger_administrateur(
    pool: &sqlx::PgPool,
    claims: &crate::auth::jwt::AccessClaims,
) -> Result<(), ApiError> {
    if est_administrateur(pool, claims.cabinet_id, claims.sub).await? {
        Ok(())
    } else {
        // 403 : la ressource (modèles, comptes du cabinet) est visible de tous les utilisateurs du cabinet ; seule l'action
        // est réservée au rôle administrateur.
        Err(ApiError::forbidden(
            "Action réservée aux administrateurs du cabinet",
        ))
    }
}

#[utoipa::path(
    get,
    path = "/collaborateurs",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Utilisateurs actifs du cabinet de l'appelant, avec leur rôle", body = Vec<CollaborateurResponse>),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn lister_collaborateurs(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<Vec<CollaborateurResponse>>, ApiError> {
    let lignes = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT id, email, role FROM utilisateurs WHERE cabinet_id = $1 AND actif ORDER BY email",
    )
    .bind(claims.cabinet_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Lecture des collaborateurs"))?;
    Ok(Json(
        lignes
            .into_iter()
            .map(|(id, email, role)| CollaborateurResponse { id, email, role })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/collaborateurs",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = CreerCollaborateurRequest,
    responses(
        (status = 200, description = "Collaborateur du cabinet (rôle collaborateur)", body = CollaborateurResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Réservé aux administrateurs du cabinet", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_collaborateur(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerCollaborateurRequest>,
) -> Result<Json<CollaborateurResponse>, ApiError> {
    exiger_administrateur(&state.pool, &claims).await?;
    let email = body.email.trim().to_owned();
    if !email.contains('@') || email.len() > 200 {
        return Err(ApiError::bad_request("E-mail invalide"));
    }
    if body.password.len() < 12 {
        return Err(ApiError::bad_request("Mot de passe trop court"));
    }
    let secret = body.totp_secret_base32.trim();
    if secret.len() < 16 {
        return Err(ApiError::bad_request("Secret TOTP invalide"));
    }
    let hash = hash_password(&body.password).map_err(|_| ApiError::internal("mot de passe"))?;
    let totp = chiffrer_secret_totp(secret.as_bytes(), &state.totp_cipher_key)
        .map_err(|_| ApiError::internal("secret TOTP"))?;
    let id = Uuid::now_v7();
    let row = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        ON CONFLICT (cabinet_id, email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            totp_secret_chiffre = EXCLUDED.totp_secret_chiffre,
            actif = TRUE
        RETURNING id, role
        "#,
    )
    .bind(id)
    .bind(claims.cabinet_id)
    .bind(&email)
    .bind(&hash)
    .bind(&totp)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création collaborateur"))?;
    Ok(Json(CollaborateurResponse {
        id: row.0,
        email,
        role: row.1,
    }))
}
