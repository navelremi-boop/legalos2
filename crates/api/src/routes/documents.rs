use std::collections::BTreeMap;
use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::routes::dossiers::dossier_visible;
use crate::state::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerDocumentRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub nom: String,
    pub idempotence_cle: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DepotDocument {
    pub document_id: Uuid,
    pub numero: i32,
    pub methode: &'static str,
    pub url: String,
    pub entetes: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScellerVersionRequest {
    pub empreinte: String,
    pub idempotence_cle: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VersionScellee {
    pub document_id: Uuid,
    pub numero: i32,
    pub empreinte: String,
    pub taille: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LectureDocument {
    pub url: String,
}

#[utoipa::path(
    post,
    path = "/documents",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = CreerDocumentRequest,
    responses((status = 200, description = "Dépôt de la version 1", body = DepotDocument))
)]
pub async fn creer_document(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerDocumentRequest>,
) -> Result<Json<DepotDocument>, ApiError> {
    if body.idempotence_cle.trim().is_empty() || body.nom.trim().is_empty() {
        return Err(ApiError::bad_request("Nom et clé d'idempotence requis"));
    }
    if !dossier_visible(&state, claims.cabinet_id, claims.sub, body.dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    let insere = sqlx::query(
        r#"
        INSERT INTO documents (id, cabinet_id, dossier_id, nom, visibilite, dossier_texte)
        SELECT $1, $2, dossiers.id, $4, dossiers.visibilite, dossiers.id::text
        FROM dossiers
        WHERE dossiers.id = $3 AND dossiers.cabinet_id = $2
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(claims.cabinet_id)
    .bind(body.dossier_id)
    .bind(body.nom.trim())
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("création document"))?;
    if insere.rows_affected() == 0 {
        let deja = sqlx::query_as::<_, (Uuid,)>(
            "SELECT id FROM documents WHERE id = $1 AND cabinet_id = $2",
        )
        .bind(body.id)
        .bind(claims.cabinet_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("lecture document"))?;
        if deja.is_none() {
            return Err(ApiError::bad_request("Dossier introuvable"));
        }
    }
    depot(&state, body.id, 1).await.map(Json)
}

#[utoipa::path(
    post,
    path = "/documents/{document_id}/versions",
    tag = "documents",
    security(("bearer_auth" = [])),
    responses((status = 200, description = "Dépôt de la version suivante", body = DepotDocument))
)]
pub async fn preparer_version(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(document_id): axum::extract::Path<Uuid>,
) -> Result<Json<DepotDocument>, ApiError> {
    verifier_document(&state, claims.cabinet_id, claims.sub, document_id).await?;
    let numero = sqlx::query_as::<_, (i32,)>(
        "SELECT COALESCE(MAX(numero), 0) + 1 FROM document_versions WHERE document_id = $1",
    )
    .bind(document_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| ApiError::internal("numéro de version"))?
    .0;
    depot(&state, document_id, numero).await.map(Json)
}

#[utoipa::path(
    post,
    path = "/documents/{document_id}/versions/{numero}/sceller",
    tag = "documents",
    security(("bearer_auth" = [])),
    request_body = ScellerVersionRequest,
    responses((status = 200, description = "Version enregistrée", body = VersionScellee))
)]
pub async fn sceller_version(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path((document_id, numero)): axum::extract::Path<(Uuid, i32)>,
    Json(body): Json<ScellerVersionRequest>,
) -> Result<Json<VersionScellee>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    verifier_document(&state, claims.cabinet_id, claims.sub, document_id).await?;
    let existante = sqlx::query_as::<_, (String, i64)>(
        "SELECT empreinte, taille FROM document_versions WHERE document_id = $1 AND numero = $2",
    )
    .bind(document_id)
    .bind(numero)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture version"))?;
    if let Some((empreinte, taille)) = existante {
        return Ok(Json(VersionScellee {
            document_id,
            numero,
            empreinte,
            taille,
        }));
    }
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let octets = stockage
        .lire(&cle_objet(document_id, numero))
        .await
        .map_err(|err| ApiError::bad_request(format!("lecture stockage : {err}")))?;
    let empreinte = hex::encode(Sha256::digest(&octets));
    if empreinte != body.empreinte.trim().to_lowercase() {
        return Err(ApiError::bad_request(
            "Empreinte différente du fichier déposé",
        ));
    }
    let taille = i64::try_from(octets.len()).unwrap_or(0);
    sqlx::query(
        r#"
        INSERT INTO document_versions (
            id, document_id, numero, empreinte, taille, auteur_id, cle_objet,
            cabinet_id, dossier_id, visibilite, dossier_texte
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, cabinet_id, dossier_id, visibilite, dossier_texte
        FROM documents WHERE id = $2
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(document_id)
    .bind(numero)
    .bind(&empreinte)
    .bind(taille)
    .bind(claims.sub)
    .bind(cle_objet(document_id, numero))
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::internal("scellement"))?;
    Ok(Json(VersionScellee {
        document_id,
        numero,
        empreinte,
        taille,
    }))
}

#[utoipa::path(
    get,
    path = "/documents/{document_id}/versions/{numero}",
    tag = "documents",
    security(("bearer_auth" = [])),
    responses((status = 200, description = "Lien de lecture", body = LectureDocument))
)]
pub async fn lire_version(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path((document_id, numero)): axum::extract::Path<(Uuid, i32)>,
) -> Result<Json<LectureDocument>, ApiError> {
    verifier_document(&state, claims.cabinet_id, claims.sub, document_id).await?;
    let presente = sqlx::query_as::<_, (i32,)>(
        "SELECT numero FROM document_versions WHERE document_id = $1 AND numero = $2",
    )
    .bind(document_id)
    .bind(numero)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture version"))?;
    if presente.is_none() {
        return Err(ApiError::bad_request("Version inconnue"));
    }
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let url = stockage
        .url_lecture(&cle_objet(document_id, numero))
        .await
        .map_err(|_| ApiError::internal("lien de lecture"))?;
    Ok(Json(LectureDocument { url }))
}

async fn depot(
    state: &AppState,
    document_id: Uuid,
    numero: i32,
) -> Result<DepotDocument, ApiError> {
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let cle = cle_objet(document_id, numero);
    let scellee = sqlx::query_as::<_, (i32,)>(
        "SELECT numero FROM document_versions WHERE document_id = $1 AND numero = $2",
    )
    .bind(document_id)
    .bind(numero)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture version"))?;
    if scellee.is_some() {
        return Err(ApiError::conflict("Version déjà scellée"));
    }
    if stockage
        .existe(&cle)
        .await
        .map_err(|_| ApiError::internal("lecture stockage"))?
    {
        return Err(ApiError::conflict("Objet déjà présent"));
    }
    let url = stockage
        .url_depot(&cle)
        .await
        .map_err(|_| ApiError::internal("lien de dépôt"))?;
    Ok(DepotDocument {
        document_id,
        numero,
        methode: "PUT",
        url,
        entetes: BTreeMap::new(),
    })
}

async fn verifier_document(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    document_id: Uuid,
) -> Result<(), ApiError> {
    let dossier = sqlx::query_as::<_, (Uuid,)>(
        "SELECT dossier_id FROM documents WHERE id = $1 AND cabinet_id = $2",
    )
    .bind(document_id)
    .bind(cabinet_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture document"))?
    .ok_or_else(|| ApiError::bad_request("Document introuvable"))?;
    if !dossier_visible(state, cabinet_id, utilisateur_id, dossier.0).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    Ok(())
}

fn cle_objet(document_id: Uuid, numero: i32) -> String {
    format!("documents/{document_id}/v{numero}")
}
