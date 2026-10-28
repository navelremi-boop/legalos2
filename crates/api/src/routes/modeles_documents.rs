//! Modèles Word du cabinet : dépôt, scellement, lecture. Le poste génère hors ligne
//! à partir de la copie qu'il a déjà ; le fichier de référence reste celui du cabinet.

use std::io::Cursor;
use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Acquire;
use utoipa::ToSchema;
use uuid::Uuid;
use zip::ZipArchive;

use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::state::AppState;

const GENRES: [&str; 3] = ["courrier", "convention", "acte"];
const TAILLE_MAX: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize, ToSchema)]
pub struct DepotModele {
    pub genre: String,
    pub methode: &'static str,
    pub url: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScellerModeleRequest {
    pub empreinte: String,
    pub idempotence_cle: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ModeleScelle {
    pub genre: String,
    pub empreinte: String,
    pub taille: i64,
    pub revision: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LectureModele {
    pub genre: String,
    pub empreinte: String,
    pub url: String,
}

fn genre_valide(genre: &str) -> bool {
    GENRES.contains(&genre)
}

fn cle_objet(cabinet_id: Uuid, genre: &str) -> String {
    format!("modeles/{cabinet_id}/{genre}.docx")
}

fn est_docx(octets: &[u8]) -> bool {
    let mut archive = match ZipArchive::new(Cursor::new(octets)) {
        Ok(archive) => archive,
        Err(_) => return false,
    };
    archive.by_name("word/document.xml").is_ok() && archive.by_name("word/styles.xml").is_ok()
}

#[utoipa::path(
    put,
    path = "/modeles-documents/{genre}",
    tag = "documents",
    security(("bearer_auth" = [])),
    params(("genre" = String, Path, description = "courrier, convention ou acte")),
    responses((status = 200, description = "Lien de dépôt du modèle", body = DepotModele))
)]
pub async fn preparer_modele(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(genre): axum::extract::Path<String>,
) -> Result<Json<DepotModele>, ApiError> {
    if !genre_valide(&genre) {
        return Err(ApiError::bad_request("Genre de modèle inconnu"));
    }
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let url = stockage
        .url_depot(&cle_objet(claims.cabinet_id, &genre))
        .await
        .map_err(|_| ApiError::internal("lien de dépôt"))?;
    Ok(Json(DepotModele {
        genre,
        methode: "PUT",
        url,
    }))
}

#[utoipa::path(
    post,
    path = "/modeles-documents/{genre}/sceller",
    tag = "documents",
    security(("bearer_auth" = [])),
    params(("genre" = String, Path, description = "courrier, convention ou acte")),
    request_body = ScellerModeleRequest,
    responses((status = 200, description = "Modèle enregistré pour le cabinet", body = ModeleScelle))
)]
pub async fn sceller_modele(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(genre): axum::extract::Path<String>,
    Json(body): Json<ScellerModeleRequest>,
) -> Result<Json<ModeleScelle>, ApiError> {
    if !genre_valide(&genre) {
        return Err(ApiError::bad_request("Genre de modèle inconnu"));
    }
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let cle = cle_objet(claims.cabinet_id, &genre);
    let octets = stockage
        .lire(&cle)
        .await
        .map_err(|_| ApiError::bad_request("Modèle absent du stockage"))?;
    if octets.len() > TAILLE_MAX || !est_docx(&octets) {
        return Err(ApiError::bad_request(
            "Le modèle doit être un document Word",
        ));
    }
    let empreinte = hex::encode(Sha256::digest(&octets));
    if empreinte != body.empreinte.trim().to_lowercase() {
        return Err(ApiError::bad_request(
            "Empreinte différente du fichier déposé",
        ));
    }
    let taille = i64::try_from(octets.len()).unwrap_or(0);
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    let cle_idem = format!("{}:{}", claims.poste_id, body.idempotence_cle.trim());
    let inseree = sqlx::query(
        r#"INSERT INTO upload_idempotence (cle) VALUES ($1) ON CONFLICT (cle) DO NOTHING"#,
    )
    .bind(&cle_idem)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("Idempotence"))?;
    if inseree.rows_affected() == 0 {
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?;
        return lire_scelle(&state, claims.cabinet_id, &genre)
            .await
            .map(Json);
    }
    sqlx::query(
        r#"
        INSERT INTO modeles_documents (
            id, cabinet_id, genre, empreinte, taille, cle_objet, revision
        ) VALUES ($1, $2, $3, $4, $5, $6, 1)
        ON CONFLICT (cabinet_id, genre) DO UPDATE
        SET empreinte = EXCLUDED.empreinte,
            taille = EXCLUDED.taille,
            cle_objet = EXCLUDED.cle_objet,
            revision = modeles_documents.revision + 1
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(claims.cabinet_id)
    .bind(&genre)
    .bind(&empreinte)
    .bind(taille)
    .bind(&cle)
    .execute(
        tx.acquire()
            .await
            .map_err(|_| ApiError::internal("Transaction"))?,
    )
    .await
    .map_err(|_| ApiError::internal("enregistrement du modèle"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("Transaction"))?;
    lire_scelle(&state, claims.cabinet_id, &genre)
        .await
        .map(Json)
}

#[utoipa::path(
    get,
    path = "/modeles-documents/{genre}",
    tag = "documents",
    security(("bearer_auth" = [])),
    params(("genre" = String, Path, description = "courrier, convention ou acte")),
    responses((status = 200, description = "Lien de lecture du modèle du cabinet", body = LectureModele))
)]
pub async fn lire_modele(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    axum::extract::Path(genre): axum::extract::Path<String>,
) -> Result<Json<LectureModele>, ApiError> {
    if !genre_valide(&genre) {
        return Err(ApiError::bad_request("Genre de modèle inconnu"));
    }
    let empreinte = sqlx::query_as::<_, (String,)>(
        "SELECT empreinte FROM modeles_documents WHERE cabinet_id = $1 AND genre = $2",
    )
    .bind(claims.cabinet_id)
    .bind(&genre)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture modèle"))?
    .ok_or_else(|| ApiError::not_found("Modèle du cabinet absent"))?
    .0;
    let stockage = state
        .stockage
        .as_ref()
        .ok_or_else(|| ApiError::internal("stockage absent"))?;
    let url = stockage
        .url_lecture(&cle_objet(claims.cabinet_id, &genre))
        .await
        .map_err(|_| ApiError::internal("lien de lecture"))?;
    Ok(Json(LectureModele {
        genre,
        empreinte,
        url,
    }))
}

async fn lire_scelle(
    state: &AppState,
    cabinet_id: Uuid,
    genre: &str,
) -> Result<ModeleScelle, ApiError> {
    let ligne = sqlx::query_as::<_, (String, i64, i32)>(
        r#"
        SELECT empreinte, taille, revision
        FROM modeles_documents
        WHERE cabinet_id = $1 AND genre = $2
        "#,
    )
    .bind(cabinet_id)
    .bind(genre)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal("lecture modèle"))?
    .ok_or_else(|| ApiError::not_found("Modèle du cabinet absent"))?;
    Ok(ModeleScelle {
        genre: genre.to_owned(),
        empreinte: ligne.0,
        taille: ligne.1,
        revision: i64::from(ligne.2),
    })
}
