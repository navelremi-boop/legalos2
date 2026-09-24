use std::sync::Arc;

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};

use crate::auth::jwt::AccessClaims;
use crate::error::ApiError;
use crate::state::AppState;

pub struct AuthAccess(pub AccessClaims);

impl FromRequestParts<Arc<AppState>> for AuthAccess {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| ApiError::unauthorized("Authorization Bearer requis"))?;

        let token = header
            .strip_prefix("Bearer ")
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| ApiError::unauthorized("Authorization Bearer requis"))?;

        let claims = state
            .jwt
            .decode_access(&state.jwt_issuer, &state.jwt_audience, token)
            .map_err(|_| ApiError::unauthorized("Jeton d'accès invalide ou expiré"))?;

        Ok(AuthAccess(claims))
    }
}
