use std::sync::Arc;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::service;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct ConnexionRequest {
    /// Adresse e-mail de l'utilisateur (identifiant).
    pub email: String,
    /// Mot de passe en clair (TLS obligatoire en production).
    pub password: String,
    /// Nom affiché du poste (registre des postes).
    pub nom_appareil: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ConnexionResponse {
    /// Indique si une seconde étape TOTP est requise.
    pub totp_requis: bool,
    /// Jeton d'accès court (JWT) si la 2FA n'est pas requise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    /// Jeton provisoire pour l'étape TOTP.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TotpVerifyRequest {
    /// Jeton provisoire émis après la première étape de connexion.
    pub session_token: String,
    /// Code à six chiffres du authenticator.
    pub code_totp: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TotpVerifyResponse {
    pub access_token: String,
    pub refresh_token: String,
}

#[utoipa::path(
    post,
    path = "/auth/connexion",
    tag = "auth",
    request_body = ConnexionRequest,
    responses(
        (status = 401, description = "Identifiants invalides", body = crate::error::ApiErrorBody),
        (status = 200, description = "Connexion réussie ou TOTP requis", body = ConnexionResponse)
    )
)]
pub async fn connexion(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConnexionRequest>,
) -> Result<Json<ConnexionResponse>, ApiError> {
    let result =
        service::connexion(&state, &body.email, &body.password, &body.nom_appareil).await?;
    Ok(Json(ConnexionResponse {
        totp_requis: result.totp_requis,
        access_token: result.access_token,
        session_token: result.session_token,
    }))
}

#[utoipa::path(
    post,
    path = "/auth/totp/verifier",
    tag = "auth",
    request_body = TotpVerifyRequest,
    responses(
        (status = 401, description = "Code ou session invalide", body = crate::error::ApiErrorBody),
        (status = 200, description = "Jetons émis", body = TotpVerifyResponse)
    )
)]
pub async fn totp_verifier(
    State(state): State<Arc<AppState>>,
    Json(body): Json<TotpVerifyRequest>,
) -> Result<Json<TotpVerifyResponse>, ApiError> {
    let result = service::verifier_totp(&state, &body.session_token, &body.code_totp).await?;
    Ok(Json(TotpVerifyResponse {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct JwksResponse {
    pub keys: Vec<serde_json::Value>,
}

#[utoipa::path(
    get,
    path = "/auth/jwks",
    tag = "auth",
    responses(
        (status = 200, description = "JSON Web Key Set pour PowerSync", body = JwksResponse)
    )
)]
pub async fn jwks(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(service::jwks(&state))
}
