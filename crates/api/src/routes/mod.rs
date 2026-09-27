pub mod auth;
pub mod cabinets;
pub mod collaborateurs;
pub mod documents;
pub mod dossiers;
pub mod factures;
pub mod health;
pub mod temps;

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
        .route(
            "/cabinets/{cabinet_id}/reference",
            get(cabinets::lire_reference).put(cabinets::ecrire_reference),
        )
        .route("/dossiers", post(dossiers::creer_dossier))
        .route("/dossiers/{dossier_id}", patch(dossiers::patch_dossier))
        .route(
            "/dossiers/{dossier_id}/parties",
            post(dossiers::creer_partie),
        )
        .route("/parties/{partie_id}", patch(dossiers::patch_partie))
        .route("/collaborateurs", post(collaborateurs::creer_collaborateur))
        .route("/documents", post(documents::creer_document))
        .route(
            "/documents/{document_id}/versions",
            post(documents::preparer_version),
        )
        .route(
            "/documents/{document_id}/versions/{numero}/sceller",
            post(documents::sceller_version),
        )
        .route(
            "/documents/{document_id}/versions/{numero}",
            get(documents::lire_version),
        )
        .route("/factures", post(factures::creer_brouillon))
        .route("/factures/{id}/valider", post(factures::valider))
        .route("/factures/{id}/emettre", post(factures::emettre))
        .route("/factures/{id}/encaissements", post(factures::encaisser))
        .route("/factures/{id}/avoir", post(factures::avoir))
        .route("/factures/{id}/cii", get(factures::lire_cii))
        .route("/factures/{id}/pdf", get(factures::lire_pdf))
        .route("/annuaire/{siren}", get(factures::annuaire))
        .route("/temps", post(temps::creer_temps))
        .route("/temps/{temps_id}", patch(temps::patch_temps))
        .route("/brouillons-facture", post(temps::creer_brouillon_temps))
        .route(
            "/brouillons-facture/{brouillon_id}",
            patch(temps::patch_brouillon),
        )
        .route("/taux-horaires", post(temps::creer_taux))
        .route("/taux-horaires/{taux_id}", patch(temps::patch_taux))
        .with_state(state)
}
