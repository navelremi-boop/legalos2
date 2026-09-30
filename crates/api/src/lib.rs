pub mod auth;
pub mod config;
pub mod conflits;
pub mod db;
pub mod error;
pub mod facturation;
pub mod install;
pub mod openapi;
pub mod pdf_facturx;
pub mod plateforme;
pub mod routes;
pub mod state;
pub mod texte_document;

use std::sync::Arc;

use axum::http::{HeaderValue, Method};
use axum::Router;
use sqlx::PgPool;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::state::AppState;

pub fn build_router(state: Arc<AppState>) -> Router {
    let openapi = openapi::ApiDoc::openapi();
    Router::new()
        .merge(routes::router(state.clone()))
        .merge(SwaggerUi::new("/docs").url("/openapi.json", openapi))
        .layer(couche_cors())
        .layer(TraceLayer::new_for_http())
}

/// Origines Tauri / WebView toujours acceptées (build distribué compris).
const ORIGINES_TOUJOURS: [&str; 4] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://asset.localhost",
];

/// Origines du serveur Vite : uniquement si `LEGALOS_MODE=development`.
const ORIGINES_DEV_VITE: [&str; 2] = ["http://localhost:1420", "http://127.0.0.1:1420"];

pub fn couche_cors() -> CorsLayer {
    couche_cors_selon_developpement(config::mode_developpement())
}

/// Couche CORS paramétrable (tests) : Vite `:1420` seulement en développement.
pub fn couche_cors_selon_developpement(developpement: bool) -> CorsLayer {
    let mut origines: Vec<HeaderValue> = ORIGINES_TOUJOURS
        .iter()
        .map(|o| HeaderValue::from_static(o))
        .collect();
    if developpement {
        origines.extend(
            ORIGINES_DEV_VITE
                .iter()
                .map(|o| HeaderValue::from_static(o)),
        );
    }
    CorsLayer::new()
        .allow_origin(origines)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any)
}

pub async fn bootstrap_pool(config: &config::Config) -> anyhow::Result<PgPool> {
    let pool = db::connect_pool(&config.database_url).await?;
    if config.run_migrations {
        db::appliquer_migrations(&pool).await?;
    }
    Ok(pool)
}

pub async fn build_app_state(
    config: &config::Config,
    pool: PgPool,
) -> anyhow::Result<Arc<AppState>> {
    let jwt = auth::service::build_jwt_keys(config).await?;
    let stockage = match &config.s3 {
        Some(parametres) => Some(legalos_stockage::StockageFichiers::connecter(
            &legalos_stockage::ParametresS3 {
                endpoint_interne: parametres.endpoint_interne.clone(),
                endpoint_public: parametres.endpoint_public.clone(),
                region: parametres.region.clone(),
                bucket: parametres.bucket.clone(),
                access_key_id: parametres.access_key_id.clone(),
                secret_access_key: parametres.secret_access_key.clone(),
            },
        )?),
        None => None,
    };
    Ok(Arc::new(AppState {
        pool,
        jwt,
        stockage,
        totp_cipher_key: config.totp_cipher_key,
        jwt_issuer: config.jwt_issuer.clone(),
        jwt_audience: config.jwt_audience.clone(),
        access_token_ttl_secs: config.access_token_ttl_secs,
        session_token_ttl_secs: config.session_token_ttl_secs,
        refresh_token_ttl_secs: config.refresh_token_ttl_secs,
        messagerie: config.messagerie.as_ref().map(|m| {
            legalos_messagerie::ParametresCompte {
                hote: m.imap_hote.clone(),
                port: m.imap_port,
                utilisateur: m.utilisateur.clone(),
                mot_de_passe: m.mot_de_passe.clone(),
                tls: m.tls,
            }
        }),
    }))
}
