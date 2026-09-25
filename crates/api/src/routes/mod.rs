pub mod auth;
pub mod cabinets;
pub mod collaborateurs;
pub mod dossiers;
pub mod health;

use std::sync::Arc;

use axum::{
    routing::{get, patch, post},
    Router,
};

use crate::state::AppState;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health::health))
        .route("/auth/connexion", post(auth::connexion))
        .route("/auth/totp/verifier", post(auth::totp_verifier))
        .route("/auth/jwks", get(auth::jwks))
        .route("/cabinets/me", get(cabinets::cabinet_me))
        .route("/cabinets/{cabinet_id}", patch(cabinets::patch_cabinet))
        .route("/dossiers", post(dossiers::creer_dossier))
        .route(
            "/dossiers/{dossier_id}/parties",
            post(dossiers::creer_partie),
        )
        .route("/collaborateurs", post(collaborateurs::creer_collaborateur))
        .with_state(state)
}
