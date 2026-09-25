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
}

#[utoipa::path(
    post,
    path = "/collaborateurs",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = CreerCollaborateurRequest,
    responses(
        (status = 200, description = "Collaborateur du cabinet", body = CollaborateurResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_collaborateur(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerCollaborateurRequest>,
) -> Result<Json<CollaborateurResponse>, ApiError> {
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
    let row = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        ON CONFLICT (cabinet_id, email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            totp_secret_chiffre = EXCLUDED.totp_secret_chiffre,
            actif = TRUE
        RETURNING id
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
    Ok(Json(CollaborateurResponse { id: row.0, email }))
}
