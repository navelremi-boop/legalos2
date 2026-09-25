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
    /// Claim `aud` des JWT d'accès (doit correspondre à `client_auth.audience` PowerSync).
    pub jwt_audience: String,
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
        let jwt_audience =
            std::env::var("JWT_AUDIENCE").unwrap_or_else(|_| "legalos-powersync".into());

        let cipher_raw = std::env::var("SECRETS_CHIFFREMENT_KEY")
            .map_err(|_| anyhow::anyhow!("SECRETS_CHIFFREMENT_KEY est requis"))?;
        refuser_cle_connue_hors_developpement(cipher_raw.trim())?;
        let totp_cipher_key = decode_cipher_key(&cipher_raw)?;

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
            jwt_audience,
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

/// Valeurs publiées (`.env.example`, recette). Interdites dès que `LEGALOS_MODE` n'est pas `development`.
pub const CLES_CHIFFREMENT_CONNUES: &[&str] = &["legalos_demo_chiffrement_32oct!!"];

pub fn mode_developpement() -> bool {
    std::env::var("LEGALOS_MODE")
        .ok()
        .is_some_and(|v| v == "development")
}

pub fn refuser_cle_connue_hors_developpement(raw: &str) -> anyhow::Result<()> {
    if mode_developpement() {
        return Ok(());
    }
    if CLES_CHIFFREMENT_CONNUES.contains(&raw.trim()) {
        anyhow::bail!(
            "SECRETS_CHIFFREMENT_KEY est une valeur de démonstration connue ; démarrage refusé hors LEGALOS_MODE=development"
        );
    }
    Ok(())
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
    if trimmed.len() == 32 {
        let mut key = [0u8; 32];
        key.copy_from_slice(trimmed.as_bytes());
        return Ok(key);
    }
    anyhow::bail!("SECRETS_CHIFFREMENT_KEY doit être 32 octets (base64 ou UTF-8 brut)")
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::decode_cipher_key;
    use crate::auth::totp;

    const DEMO_KEY_STR: &str = "legalos_demo_chiffrement_32oct!!";
    const DEMO_TOTP_CIPHERTEXT: &str =
        "bGVnYWxvcy1kZW1vaN5wGHZGUzOAk20UHXmNR4HEPpOKaY7St3edVKzmtW2h4U1TP4NJKB/QL/SXCuuuuQ==";
    const DEMO_TOTP_PLAIN: &str = "MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO";

    #[test]
    fn decode_demo_cipher_key_is_utf8_not_misread_base64() {
        let key = decode_cipher_key(DEMO_KEY_STR).expect("clé démo");
        let expected: [u8; 32] = *b"legalos_demo_chiffrement_32oct!!";
        assert_eq!(
            key, expected,
            "clé démo : decode_cipher_key ne doit pas interpréter la chaîne UTF-8 comme base64"
        );
    }

    #[test]
    fn decode_demo_cipher_key_matches_migration_totp() {
        let key = decode_cipher_key(DEMO_KEY_STR).expect("clé démo");
        let plain = totp::dechiffrer_secret_totp(DEMO_TOTP_CIPHERTEXT, &key).expect("déchiffrer");
        assert_eq!(String::from_utf8(plain).expect("utf8"), DEMO_TOTP_PLAIN);
    }
}
