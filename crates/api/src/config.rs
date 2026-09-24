use std::net::SocketAddr;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    pub run_migrations: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind = std::env::var("API_BIND").unwrap_or_else(|_| "0.0.0.0:8080".into());
        let bind: SocketAddr = bind.parse()?;
        let database_url = std::env::var("DATABASE_URL")
            .map_err(|_| anyhow::anyhow!("DATABASE_URL est requis"))?;
        let run_migrations = std::env::var("API_RUN_MIGRATIONS")
            .map(|v| v != "0" && v.to_lowercase() != "false")
            .unwrap_or(true);
        Ok(Self {
            bind,
            database_url,
            run_migrations,
        })
    }
}
