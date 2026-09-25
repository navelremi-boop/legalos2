use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::Acquire;
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
    pub base_revision: i64,
    pub idempotence_cle: String,
    pub nom: Option<String>,
    pub slug: Option<String>,
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
    charger_cabinet(&state, claims.cabinet_id).await.map(Json)
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
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if body.base_revision < 1 {
        return Err(ApiError::bad_request("Version de base invalide"));
    }
    let nom = champ_optionnel(body.nom)?;
    let slug = champ_optionnel(body.slug)?;
    if nom.is_none() && slug.is_none() {
        return Err(ApiError::bad_request("Aucun champ à appliquer"));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;

    let inserted = sqlx::query(
        r#"INSERT INTO upload_idempotence (cle) VALUES ($1) ON CONFLICT (cle) DO NOTHING"#,
    )
    .bind(body.idempotence_cle.trim())
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Idempotence"))?;

    if inserted.rows_affected() == 0 {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return charger_cabinet(&state, cabinet_id).await.map(Json);
    }

    let courant = sqlx::query_as::<_, (i64, String, String)>(
        r#"SELECT revision, nom, slug FROM cabinets WHERE id = $1 FOR UPDATE"#,
    )
    .bind(cabinet_id)
    .fetch_optional(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Base de données"))?
    .ok_or_else(|| ApiError::bad_request("Cabinet introuvable"))?;

    if body.base_revision > courant.0 {
        return Err(ApiError::bad_request(
            "Version de base postérieure au serveur",
        ));
    }

    let mut revision = courant.0;
    appliquer_champ(
        &mut tx,
        cabinet_id,
        claims.poste_id,
        "nom",
        nom.as_deref(),
        &courant.1,
        body.base_revision,
        &mut revision,
    )
    .await?;
    appliquer_champ(
        &mut tx,
        cabinet_id,
        claims.poste_id,
        "slug",
        slug.as_deref(),
        &courant.2,
        body.base_revision,
        &mut revision,
    )
    .await?;

    if revision != courant.0 {
        sqlx::query(r#"UPDATE cabinets SET revision = $1 WHERE id = $2"#)
            .bind(revision)
            .bind(cabinet_id)
            .execute(
                tx.acquire()
                    .await
                    .map_err(|_| ApiError::internal("Transaction"))?,
            )
            .await
            .map_err(|_| ApiError::internal("Révision cabinet"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    charger_cabinet(&state, cabinet_id).await.map(Json)
}

fn champ_optionnel(valeur: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(valeur) = valeur else {
        return Ok(None);
    };
    let valeur = valeur.trim().to_owned();
    if valeur.is_empty() {
        return Err(ApiError::bad_request("Champ vide"));
    }
    Ok(Some(valeur))
}

async fn appliquer_champ(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    cabinet_id: Uuid,
    poste_id: Uuid,
    champ: &str,
    nouvelle: Option<&str>,
    actuelle: &str,
    base_revision: i64,
    revision: &mut i64,
) -> Result<(), ApiError> {
    let Some(nouvelle) = nouvelle else {
        return Ok(());
    };
    let conflit = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM journal_modifications
            WHERE enregistrement_id = $1 AND champ = $2 AND revision_appliquee > $3
        )
        "#,
    )
    .bind(cabinet_id)
    .bind(champ)
    .bind(base_revision)
    .fetch_one(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Journal"))?;

    let colonne = match champ {
        "nom" => "nom",
        "slug" => "slug",
        _ => return Err(ApiError::bad_request("Champ non autorisé")),
    };
    let sql = format!("UPDATE cabinets SET {colonne} = $1 WHERE id = $2");
    sqlx::query(&sql)
        .bind(nouvelle)
        .bind(cabinet_id)
        .execute(
            tx.acquire()
                .await
                .map_err(|_| ApiError::internal("Transaction"))?,
        )
        .await
        .map_err(|_| ApiError::bad_request("Champ refusé"))?;

    *revision += 1;
    sqlx::query(
        r#"
        INSERT INTO journal_modifications (
            id, cabinet_id, table_cible, enregistrement_id, champ,
            valeur_remplacee, valeur_appliquee, revision_base, revision_appliquee,
            poste_id, conflit
        )
        VALUES ($1, $2, 'cabinets', $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(cabinet_id)
    .bind(champ)
    .bind(actuelle)
    .bind(nouvelle)
    .bind(base_revision)
    .bind(*revision)
    .bind(poste_id)
    .bind(conflit)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Journal"))?;
    Ok(())
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
