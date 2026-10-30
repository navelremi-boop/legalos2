//! Qualités du cabinet : création et retrait réservés aux administrateurs.

use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::conflits::{cle_idempotence, reserver_idempotence};
use crate::error::ApiError;
use crate::routes::collaborateurs::exiger_administrateur;
use crate::state::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerQualiteRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub code: String,
    pub libelle: String,
    pub admet_rattachement: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RetirerQualiteRequest {
    pub idempotence_cle: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RetraitQualiteResponse {
    pub effet: String,
}

pub fn valider_code_qualite(code: &str) -> Result<(), ApiError> {
    let ok = !code.is_empty()
        && code.len() <= 40
        && code
            .bytes()
            .all(|octet| octet.is_ascii_lowercase() || octet.is_ascii_digit() || octet == b'_');
    if !ok {
        return Err(ApiError::bad_request("Code de qualité invalide"));
    }
    Ok(())
}

/// Archive si un intervenant l'utilise, sinon retire la ligne. Déjà archivée : sans nouvel effet.
pub async fn appliquer_retrait_qualite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    qualite_id: Uuid,
) -> Result<&'static str, ApiError> {
    let ligne = sqlx::query("SELECT archivee FROM qualites WHERE id = $1 AND cabinet_id = $2")
        .bind(qualite_id)
        .bind(cabinet_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("lecture qualité"))?
        .ok_or_else(|| ApiError::not_found("Qualité introuvable"))?;
    let archivee: bool = ligne
        .try_get("archivee")
        .map_err(|_| ApiError::internal("lecture qualité"))?;
    if archivee {
        return Ok("archive");
    }
    let utilisee = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dossier_intervenants WHERE qualite_id = $1)",
    )
    .bind(qualite_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal("lecture intervenants"))?;
    if utilisee {
        sqlx::query("UPDATE qualites SET archivee = TRUE, revision = revision + 1 WHERE id = $1")
            .bind(qualite_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| ApiError::internal("archivage qualité"))?;
        return Ok("archive");
    }
    sqlx::query("DELETE FROM qualites WHERE id = $1")
        .bind(qualite_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal("suppression qualité"))?;
    Ok("supprime")
}

#[utoipa::path(
    post,
    path = "/qualites",
    tag = "contacts",
    security(("bearer_auth" = [])),
    request_body = CreerQualiteRequest,
    responses(
        (status = 200, description = "Qualité créée ou déjà présente"),
        (status = 400, description = "Code ou libellé invalide", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Réservé aux administrateurs du cabinet", body = crate::error::ApiErrorBody),
        (status = 409, description = "Ce code existe déjà", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_qualite(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerQualiteRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let code = body.code.trim().to_string();
    valider_code_qualite(&code)?;
    let libelle = body.libelle.trim();
    if libelle.is_empty() {
        return Err(ApiError::bad_request("Libellé requis"));
    }
    exiger_administrateur(&state.pool, &claims).await?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if reserver_idempotence(&mut tx, &cle).await? {
        let deja = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM qualites WHERE cabinet_id = $1 AND code = $2)",
        )
        .bind(claims.cabinet_id)
        .bind(&code)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("lecture qualité"))?;
        if deja {
            return Err(ApiError::conflict("Cette qualité existe déjà"));
        }
        sqlx::query(
            "INSERT INTO qualites (id, cabinet_id, code, libelle, admet_rattachement) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(body.id)
        .bind(claims.cabinet_id)
        .bind(&code)
        .bind(libelle)
        .bind(body.admet_rattachement)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("création qualité"))?;
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    Ok(Json(serde_json::json!({ "id": body.id })))
}

#[utoipa::path(
    post,
    path = "/qualites/{qualite_id}/retrait",
    tag = "contacts",
    security(("bearer_auth" = [])),
    params(("qualite_id" = Uuid, Path, description = "Qualité à retirer")),
    request_body = RetirerQualiteRequest,
    responses(
        (status = 200, description = "Archivée si elle est utilisée, supprimée sinon", body = RetraitQualiteResponse),
        (status = 400, description = "Clé d'idempotence manquante", body = crate::error::ApiErrorBody),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
        (status = 403, description = "Réservé aux administrateurs du cabinet", body = crate::error::ApiErrorBody),
        (status = 404, description = "Qualité introuvable", body = crate::error::ApiErrorBody),
    )
)]
pub async fn retirer_qualite(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(qualite_id): axum::extract::Path<Uuid>,
    Json(body): Json<RetirerQualiteRequest>,
) -> Result<Json<RetraitQualiteResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    exiger_administrateur(&state.pool, &claims).await?;
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle = cle_idempotence(claims.poste_id, &body.idempotence_cle);
    if !reserver_idempotence(&mut tx, &cle).await? {
        let archivee = sqlx::query_scalar::<_, bool>(
            "SELECT archivee FROM qualites WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(qualite_id)
        .bind(claims.cabinet_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("lecture qualité"))?;
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        let effet = match archivee {
            None => "supprime",
            Some(true) => "archive",
            Some(false) => "archive",
        };
        return Ok(Json(RetraitQualiteResponse {
            effet: effet.into(),
        }));
    }
    let effet = appliquer_retrait_qualite(&mut tx, claims.cabinet_id, qualite_id).await?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    Ok(Json(RetraitQualiteResponse {
        effet: effet.into(),
    }))
}
