pub mod auth;
pub mod health;

use axum::{
    routing::{get, post},
    Router,
};

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route("/auth/connexion", post(auth::connexion))
        .route("/auth/totp/verifier", post(auth::totp_verifier))
        .route("/auth/jwks", get(auth::jwks))
}
