pub mod agenda;
pub mod auth;
pub mod cabinets;
pub mod collaborateurs;
pub mod contacts;
pub mod documents;
pub mod dossiers;
pub mod factures;
pub mod health;
pub mod intercalaires;
pub mod messagerie;
pub mod temps;

use std::sync::Arc;

use axum::{
    routing::{delete, get, patch, post},
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
        .route("/contacts", post(contacts::creer_contact))
        .route("/contacts/{contact_id}", patch(contacts::patch_contact))
        .route(
            "/contacts/{contact_id}/historique",
            get(contacts::historique_contact),
        )
        .route(
            "/dossiers/{dossier_id}/liens",
            post(contacts::lier_dossiers),
        )
        .route("/dossiers/{dossier_id}/agenda", post(agenda::creer_element))
        .route(
            "/agenda/{element_id}",
            patch(agenda::patch_element).delete(agenda::retirer_element),
        )
        .route(
            "/dossiers/{dossier_id}/intercalaires",
            post(intercalaires::creer_intercalaire),
        )
        .route(
            "/intercalaires/{intercalaire_id}",
            patch(intercalaires::patch_intercalaire).delete(intercalaires::retirer_intercalaire),
        )
        .route(
            "/intercalaires/{intercalaire_id}/elements",
            post(intercalaires::rattacher_element),
        )
        .route(
            "/intercalaire-elements/{element_lien_id}",
            delete(intercalaires::detacher_element),
        )
        .route("/collaborateurs", post(collaborateurs::creer_collaborateur))
        .route("/repertoires", post(documents::creer_repertoire))
        .route(
            "/repertoires/{repertoire_id}",
            patch(documents::patch_repertoire),
        )
        .route("/documents", post(documents::creer_document))
        .route("/documents/{document_id}", patch(documents::patch_document))
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
        .route(
            "/messagerie/classement/relever",
            post(messagerie::relever_classement),
        )
        .route("/messagerie/messages", get(messagerie::lister_messages))
        .route(
            "/messagerie/messages/{message_id}/accepter-suggestion",
            post(messagerie::accepter_suggestion),
        )
        .route(
            "/dossiers/{dossier_id}/chrono-mails",
            get(messagerie::chrono_mails_dossier),
        )
        .with_state(state)
}
