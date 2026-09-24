use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::error::ApiError;

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
    /// Jeton d'accès court (JWT) — non émis tant que l'auth n'est pas implémentée.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
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
        (status = 501, description = "Non implémenté (J0.6 — contrat seulement)", body = crate::error::ApiErrorBody),
        (status = 200, description = "Connexion réussie ou TOTP requis", body = ConnexionResponse)
    )
)]
pub async fn connexion(
    Json(body): Json<ConnexionRequest>,
) -> Result<Json<ConnexionResponse>, ApiError> {
    let _ = (&body.email, &body.password, &body.nom_appareil);
    Err(ApiError::not_implemented(
        "Authentification argon2 + JWT : phase 1 (S2)",
    ))
}

#[utoipa::path(
    post,
    path = "/auth/totp/verifier",
    tag = "auth",
    request_body = TotpVerifyRequest,
    responses(
        (status = 501, description = "Non implémenté (J0.6 — contrat seulement)", body = crate::error::ApiErrorBody),
        (status = 200, description = "Jetons émis", body = TotpVerifyResponse)
    )
)]
pub async fn totp_verifier(
    Json(body): Json<TotpVerifyRequest>,
) -> Result<Json<TotpVerifyResponse>, ApiError> {
    let _ = (&body.session_token, &body.code_totp);
    Err(ApiError::not_implemented(
        "Vérification TOTP : phase 1 (S2)",
    ))
}

#[utoipa::path(
    get,
    path = "/auth/jwks",
    tag = "auth",
    responses(
        (status = 501, description = "Non implémenté (J0.6 — contrat seulement)", body = crate::error::ApiErrorBody),
        (status = 200, description = "JSON Web Key Set pour PowerSync")
    )
)]
pub async fn jwks() -> Result<Json<serde_json::Value>, ApiError> {
    Err(ApiError::not_implemented(
        "Exposition JWKS pour PowerSync : phase 1 (S2)",
    ))
}
