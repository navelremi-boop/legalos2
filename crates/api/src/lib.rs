pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod facturation;
pub mod install;
pub mod openapi;
pub mod routes;
pub mod state;

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

fn couche_cors() -> CorsLayer {
    const ORIGINES: [&str; 5] = [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://asset.localhost",
    ];
    CorsLayer::new()
        .allow_origin(ORIGINES.map(HeaderValue::from_static))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::OPTIONS])
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
    }))
}
