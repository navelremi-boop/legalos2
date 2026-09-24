use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct CabinetResponse {
    pub id: Uuid,
    pub slug: String,
    pub nom: String,
    pub totp_obligatoire: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchCabinetRequest {
    pub nom: String,
}

#[utoipa::path(
    get,
    path = "/cabinets/me",
    tag = "cabinets",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Cabinet courant (JWT)", body = CabinetResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn cabinet_me(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
) -> Result<Json<CabinetResponse>, ApiError> {
    charger_cabinet(&state, claims.cabinet_id)
        .await
        .map(Json)
}

#[utoipa::path(
    patch,
    path = "/cabinets/{cabinet_id}",
    tag = "cabinets",
    security(("bearer_auth" = [])),
    request_body = PatchCabinetRequest,
    responses(
        (status = 200, description = "Cabinet mis à jour", body = CabinetResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Cabinet interdit", body = crate::error::ApiErrorBody),
    )
)]
pub async fn patch_cabinet(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(cabinet_id): axum::extract::Path<Uuid>,
    Json(body): Json<PatchCabinetRequest>,
) -> Result<Json<CabinetResponse>, ApiError> {
    if cabinet_id != claims.cabinet_id {
        return Err(ApiError::unauthorized("Cabinet non autorisé pour ce jeton"));
    }
    let nom = body.nom.trim();
    if nom.is_empty() {
        return Err(ApiError::bad_request("Nom de cabinet requis"));
    }
    sqlx::query(
        r#"
        UPDATE cabinets
        SET nom = $1
        WHERE id = $2
        "#,
    )
    .bind(nom)
    .bind(cabinet_id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Mise à jour cabinet"))?;

    charger_cabinet(&state, cabinet_id).await.map(Json)
}

async fn charger_cabinet(state: &AppState, cabinet_id: Uuid) -> Result<CabinetResponse, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, String, bool)>(
        r#"SELECT id, slug, nom, totp_obligatoire FROM cabinets WHERE id = $1"#,
    )
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("Base de données"))?
    .ok_or_else(|| ApiError::bad_request("Cabinet introuvable"))?;

    Ok(CabinetResponse {
        id: row.0,
        slug: row.1,
        nom: row.2,
        totp_obligatoire: row.3,
    })
}
