use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

const CHEMISES: &[&str] = &[
    "kraft",
    "bleu-classeur",
    "vert-amande",
    "jaune-paille",
    "rose-buvard",
    "lilas",
    "vert-eau",
    "gris-perle",
];

const ROLES_PARTIE: &[&str] = &["client", "adversaire", "confrere"];

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerDossierRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub nom: String,
    pub chemise: String,
    pub juridiction: String,
    pub numero_rg: String,
    pub restreint: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DossierResponse {
    pub id: Uuid,
    pub nom: String,
    pub restreint: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerPartieRequest {
    pub id: Uuid,
    pub idempotence_cle: String,
    pub role: String,
    pub nom: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PartieResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub nom: String,
}

#[utoipa::path(
    post,
    path = "/dossiers",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = CreerDossierRequest,
    responses(
        (status = 200, description = "Dossier créé ou déjà présent", body = DossierResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_dossier(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerDossierRequest>,
) -> Result<Json<DossierResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = texte_requis(&body.nom, "Nom requis")?;
    let juridiction = texte_requis(&body.juridiction, "Juridiction requise")?;
    let numero_rg = texte_requis(&body.numero_rg, "Numéro RG requis")?;
    if !CHEMISES.contains(&body.chemise.as_str()) {
        return Err(ApiError::bad_request("Couleur de chemise inconnue"));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("transaction"))?;
    let existant = sqlx::query_as::<_, (Uuid, bool)>(
        "SELECT cabinet_id, restreint FROM dossiers WHERE id = $1",
    )
    .bind(body.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("lecture dossier"))?;
    if let Some((cabinet_id, restreint)) = existant {
        if cabinet_id != claims.cabinet_id {
            return Err(ApiError::unauthorized("Dossier hors cabinet"));
        }
        return Ok(Json(DossierResponse {
            id: body.id,
            nom,
            restreint,
        }));
    }

    sqlx::query(
        r#"
        INSERT INTO dossiers (
            id, cabinet_id, nom, chemise, juridiction, numero_rg, restreint, visibilite, revision
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 THEN 'restreint' ELSE 'public' END, 1)
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(&nom)
    .bind(&body.chemise)
    .bind(&juridiction)
    .bind(&numero_rg)
    .bind(body.restreint)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("création dossier"))?;

    if body.restreint {
        sqlx::query(
            r#"
            INSERT INTO dossier_acces (dossier_id, utilisateur_id, dossier_texte, utilisateur_texte)
            VALUES ($1, $2, $1::text, $2::text)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(body.id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("droit dossier"))?;
    }

    tx.commit()
        .await
        .map_err(|_| ApiError::internal("validation dossier"))?;
    Ok(Json(DossierResponse {
        id: body.id,
        nom,
        restreint: body.restreint,
    }))
}

#[utoipa::path(
    post,
    path = "/dossiers/{dossier_id}/parties",
    tag = "dossiers",
    security(("bearer_auth" = [])),
    request_body = CreerPartieRequest,
    responses(
        (status = 200, description = "Partie créée ou déjà présente", body = PartieResponse),
        (status = 401, description = "Non authentifié", body = crate::error::ApiErrorBody),
    )
)]
pub async fn creer_partie(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(dossier_id): axum::extract::Path<Uuid>,
    Json(body): Json<CreerPartieRequest>,
) -> Result<Json<PartieResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let nom = texte_requis(&body.nom, "Nom de partie requis")?;
    if !ROLES_PARTIE.contains(&body.role.as_str()) {
        return Err(ApiError::bad_request("Rôle de partie inconnu"));
    }
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }

    sqlx::query(
        r#"
        INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, revision, restreint, visibilite)
        VALUES (
            $1, $2, $3, $4, $5, 1,
            (SELECT restreint FROM dossiers WHERE id = $2),
            (SELECT visibilite FROM dossiers WHERE id = $2)
        )
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(dossier_id)
    .bind(claims.cabinet_id)
    .bind(&body.role)
    .bind(&nom)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création partie"))?;

    Ok(Json(PartieResponse {
        id: body.id,
        dossier_id,
        nom,
    }))
}

async fn dossier_visible(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    dossier_id: Uuid,
) -> Result<bool, ApiError> {
    let row = sqlx::query_as::<_, (bool,)>(
        r#"
        SELECT (
            d.cabinet_id = $2
            AND (
                d.restreint = FALSE
                OR EXISTS (
                    SELECT 1 FROM dossier_acces a
                    WHERE a.dossier_id = d.id AND a.utilisateur_id = $3
                )
            )
        )
        FROM dossiers d
        WHERE d.id = $1
        "#,
    )
    .bind(dossier_id)
    .bind(cabinet_id)
    .bind(utilisateur_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture droit dossier"))?;
    Ok(row.is_some_and(|v| v.0))
}

fn texte_requis(valeur: &str, message: &str) -> Result<String, ApiError> {
    let texte = valeur.trim();
    if texte.is_empty() {
        return Err(ApiError::bad_request(message));
    }
    Ok(texte.to_owned())
}
