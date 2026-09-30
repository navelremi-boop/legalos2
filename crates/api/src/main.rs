use legalos_api::bootstrap_pool;
use legalos_api::build_app_state;
use legalos_api::build_router;
use legalos_api::config::Config;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;
    let bind = config.bind;
    let pool = bootstrap_pool(&config).await?;
    let state = build_app_state(&config, pool).await?;
    legalos_api::moteur_mail::demarrer(state.pool.clone(), state.totp_cipher_key);

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, "API LEGAL OS en écoute");
    axum::serve(listener, app).await?;
    Ok(())
}
