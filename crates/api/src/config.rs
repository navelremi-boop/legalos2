use std::net::SocketAddr;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    pub run_migrations: bool,
    pub jwt_key_id: String,
    pub jwt_rsa_private_key_pem: Option<String>,
    pub jwt_issuer: String,
    pub totp_cipher_key: [u8; 32],
    pub access_token_ttl_secs: u64,
    pub session_token_ttl_secs: u64,
    pub refresh_token_ttl_secs: u64,
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

        let jwt_key_id = std::env::var("JWT_KEY_ID").unwrap_or_else(|_| "legalos-dev-1".into());
        let jwt_rsa_private_key_pem = std::env::var("JWT_RSA_PRIVATE_KEY_PEM")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let jwt_issuer = std::env::var("JWT_ISSUER").unwrap_or_else(|_| "legalos-api".into());

        let totp_cipher_key = decode_cipher_key(
            &std::env::var("SECRETS_CHIFFREMENT_KEY")
                .map_err(|_| anyhow::anyhow!("SECRETS_CHIFFREMENT_KEY est requis"))?,
        )?;

        let access_token_ttl_secs = parse_u64_env("JWT_ACCESS_TTL_SECS", 900);
        let session_token_ttl_secs = parse_u64_env("JWT_SESSION_TTL_SECS", 600);
        let refresh_token_ttl_secs = parse_u64_env("JWT_REFRESH_TTL_SECS", 2_592_000);

        Ok(Self {
            bind,
            database_url,
            run_migrations,
            jwt_key_id,
            jwt_rsa_private_key_pem,
            jwt_issuer,
            totp_cipher_key,
            access_token_ttl_secs,
            session_token_ttl_secs,
            refresh_token_ttl_secs,
        })
    }
}

fn parse_u64_env(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn decode_cipher_key(raw: &str) -> anyhow::Result<[u8; 32]> {
    let trimmed = raw.trim();
    if let Ok(bytes) = B64.decode(trimmed) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    if trimmed.as_bytes().len() == 32 {
        let mut key = [0u8; 32];
        key.copy_from_slice(trimmed.as_bytes());
        return Ok(key);
    }
    anyhow::bail!("SECRETS_CHIFFREMENT_KEY doit être 32 octets (base64 ou UTF-8 brut)")
}
