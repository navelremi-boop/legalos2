use crate::auth::access::AuthAccess;
use crate::error::ApiError;
use crate::facturation::ht_temps_centimes;
use crate::routes::dossiers::dossier_visible;
use crate::state::AppState;
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerTempsRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub minutes: i32,
    pub libelle: String,
    pub taux_centimes_heure: i64,
    pub idempotence_cle: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct TempsResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub minutes: i32,
    pub ht_centimes: i64,
    pub taux_centimes_heure: i64,
}
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerBrouillonTempsRequest {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub temps_id: Uuid,
    pub libelle: String,
    pub ht_centimes: i64,
    pub taux_centimes_heure: i64,
    pub idempotence_cle: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct BrouillonTempsResponse {
    pub id: Uuid,
    pub dossier_id: Uuid,
    pub numero: Option<i64>,
    pub ht_centimes: i64,
}
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreerTauxRequest {
    pub id: Uuid,
    pub centimes_par_heure: i64,
    pub dossier_id: Option<Uuid>,
    pub client_partie_id: Option<Uuid>,
    pub intervenant_id: Option<Uuid>,
    pub idempotence_cle: String,
}
#[derive(Debug, Serialize, ToSchema)]
pub struct TauxResponse {
    pub id: Uuid,
    pub centimes_par_heure: i64,
}

#[utoipa::path(post, path = "/temps", tag = "factures", security(("bearer_auth" = [])), request_body = CreerTempsRequest, responses((status = 200, body = TempsResponse)))]
pub async fn creer_temps(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerTempsRequest>,
) -> Result<Json<TempsResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let libelle = texte_requis(&body.libelle, "Libellé requis")?;
    let ht = ht_temps_centimes(body.minutes, body.taux_centimes_heure)
        .ok_or_else(|| ApiError::bad_request("Minutes ou taux invalides"))?;
    exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, body.dossier_id).await?;
    let meta = meta_dossier(&state, body.dossier_id).await?;
    sqlx::query(r#"INSERT INTO temps_saisis (id, cabinet_id, dossier_id, intervenant_id, minutes, libelle, taux_centimes_heure, ht_centimes, visibilite, dossier_texte) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING"#)
        .bind(body.id).bind(claims.cabinet_id).bind(body.dossier_id).bind(claims.sub).bind(body.minutes).bind(&libelle).bind(body.taux_centimes_heure).bind(ht).bind(&meta.0).bind(&meta.1)
        .execute(&state.pool).await.map_err(|_| ApiError::internal("création temps"))?;
    Ok(Json(TempsResponse {
        id: body.id,
        dossier_id: body.dossier_id,
        minutes: body.minutes,
        ht_centimes: ht,
        taux_centimes_heure: body.taux_centimes_heure,
    }))
}

#[utoipa::path(post, path = "/brouillons-facture", tag = "factures", security(("bearer_auth" = [])), request_body = CreerBrouillonTempsRequest, responses((status = 200, body = BrouillonTempsResponse)))]
pub async fn creer_brouillon_temps(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerBrouillonTempsRequest>,
) -> Result<Json<BrouillonTempsResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    let libelle = texte_requis(&body.libelle, "Libellé requis")?;
    if body.ht_centimes <= 0 || body.taux_centimes_heure <= 0 {
        return Err(ApiError::bad_request("Montant ou taux invalides"));
    }
    exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, body.dossier_id).await?;
    let meta = meta_dossier(&state, body.dossier_id).await?;
    sqlx::query(r#"INSERT INTO brouillons_facture (id, cabinet_id, dossier_id, temps_id, numero, ht_centimes, libelle, intervenant_id, taux_centimes_heure, visibilite, dossier_texte) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING"#)
        .bind(body.id).bind(claims.cabinet_id).bind(body.dossier_id).bind(body.temps_id).bind(body.ht_centimes).bind(&libelle).bind(claims.sub).bind(body.taux_centimes_heure).bind(&meta.0).bind(&meta.1)
        .execute(&state.pool).await.map_err(|_| ApiError::internal("création brouillon"))?;
    let numero =
        sqlx::query_as::<_, (Option<i64>,)>("SELECT numero FROM brouillons_facture WHERE id = $1")
            .bind(body.id)
            .fetch_one(&state.pool)
            .await
            .map_err(|_| ApiError::internal("lecture brouillon"))?
            .0;
    Ok(Json(BrouillonTempsResponse {
        id: body.id,
        dossier_id: body.dossier_id,
        numero,
        ht_centimes: body.ht_centimes,
    }))
}

#[utoipa::path(post, path = "/taux-horaires", tag = "factures", security(("bearer_auth" = [])), request_body = CreerTauxRequest, responses((status = 200, body = TauxResponse)))]
pub async fn creer_taux(
    State(state): State<Arc<AppState>>,
    AuthAccess(claims): AuthAccess,
    Json(body): Json<CreerTauxRequest>,
) -> Result<Json<TauxResponse>, ApiError> {
    if body.idempotence_cle.trim().is_empty() {
        return Err(ApiError::bad_request("Clé d'idempotence requise"));
    }
    if body.centimes_par_heure <= 0 {
        return Err(ApiError::bad_request("Taux invalide"));
    }
    let (visibilite, dossier_texte) = if let Some(dossier_id) = body.dossier_id {
        exiger_dossier_existant(&state, claims.cabinet_id, claims.sub, dossier_id).await?;
        let meta = meta_dossier(&state, dossier_id).await?;
        (meta.0, Some(meta.1))
    } else {
        ("public".to_owned(), None)
    };
    sqlx::query(r#"INSERT INTO taux_horaires (id, cabinet_id, client_partie_id, dossier_id, intervenant_id, centimes_par_heure, visibilite, dossier_texte) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING"#)
        .bind(body.id).bind(claims.cabinet_id).bind(body.client_partie_id).bind(body.dossier_id).bind(body.intervenant_id).bind(body.centimes_par_heure).bind(&visibilite).bind(dossier_texte)
        .execute(&state.pool).await.map_err(|_| ApiError::internal("création taux"))?;
    Ok(Json(TauxResponse {
        id: body.id,
        centimes_par_heure: body.centimes_par_heure,
    }))
}

pub(crate) async fn exiger_dossier_existant(
    state: &AppState,
    cabinet_id: Uuid,
    utilisateur_id: Uuid,
    dossier_id: Uuid,
) -> Result<(), ApiError> {
    let existe =
        sqlx::query_as::<_, (Uuid,)>("SELECT id FROM dossiers WHERE id = $1 AND cabinet_id = $2")
            .bind(dossier_id)
            .bind(cabinet_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| ApiError::internal("lecture dossier"))?;
    if existe.is_none() {
        return Err(ApiError::bad_request("Dossier introuvable"));
    }
    if !dossier_visible(state, cabinet_id, utilisateur_id, dossier_id).await? {
        return Err(ApiError::unauthorized("Dossier non autorisé"));
    }
    Ok(())
}

async fn meta_dossier(state: &AppState, dossier_id: Uuid) -> Result<(String, String), ApiError> {
    sqlx::query_as::<_, (String,)>("SELECT visibilite FROM dossiers WHERE id = $1")
        .bind(dossier_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal("visibilité dossier"))?
        .map(|row| (row.0, dossier_id.to_string()))
        .ok_or_else(|| ApiError::bad_request("Dossier introuvable"))
}

fn texte_requis(valeur: &str, message: &str) -> Result<String, ApiError> {
    let texte = valeur.trim();
    if texte.is_empty() {
        return Err(ApiError::bad_request(message));
    }
    Ok(texte.to_owned())
}
