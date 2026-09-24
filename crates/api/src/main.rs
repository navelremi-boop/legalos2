mod config;
mod db;
mod error;
mod openapi;
mod routes;

use axum::Router;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = config::Config::from_env()?;
    let bind = config.bind;
    let pool = db::connect_pool(&config.database_url).await?;
    if config.run_migrations {
        db::appliquer_migrations(&pool).await?;
    }
    let _pool = pool;

    let openapi = openapi::ApiDoc::openapi();
    let app = Router::new()
        .merge(routes::router())
        .merge(SwaggerUi::new("/docs").url("/openapi.json", openapi))
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "API LEGAL OS en écoute");
    axum::serve(listener, app).await?;
    Ok(())
}
