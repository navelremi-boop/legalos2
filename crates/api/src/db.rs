use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// Sauvegarde nocturne / pré-migration (pg_dump + chiffrement) — implémentation complète en phase 1.
pub async fn sauvegarde_avant_migration() -> anyhow::Result<()> {
    tracing::info!(
        "sauvegarde pré-migration : non exécutée en J0.6 (contrat S1 — pg_dump chiffré avant migrate)"
    );
    Ok(())
}

pub async fn connect_pool(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    Ok(pool)
}

pub async fn appliquer_migrations(pool: &PgPool) -> anyhow::Result<()> {
    sauvegarde_avant_migration().await?;
    sqlx::migrate!("./migrations").run(pool).await?;
    tracing::info!("migrations sqlx appliquées");
    Ok(())
}
