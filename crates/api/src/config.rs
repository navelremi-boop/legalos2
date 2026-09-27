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
    pub s3: Option<ParametresS3>,
}

#[derive(Debug, Clone)]
pub struct ParametresS3 {
    pub endpoint_interne: String,
    pub endpoint_public: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
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
        refuser_secrets_publies_hors_developpement()?;
        let totp_cipher_key = decode_cipher_key(&cipher_raw)?;

        let access_token_ttl_secs = parse_u64_env("JWT_ACCESS_TTL_SECS", 900);
        let session_token_ttl_secs = parse_u64_env("JWT_SESSION_TTL_SECS", 600);
        let refresh_token_ttl_secs = parse_u64_env("JWT_REFRESH_TTL_SECS", 2_592_000);
        let s3 = parametres_s3();

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
            s3,
        })
    }
}

fn parametres_s3() -> Option<ParametresS3> {
    let lire = |nom: &str| {
        std::env::var(nom)
            .ok()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    };
    Some(ParametresS3 {
        endpoint_interne: lire("S3_ENDPOINT")?,
        endpoint_public: lire("S3_PUBLIC_ENDPOINT")?,
        region: lire("S3_REGION")?,
        bucket: lire("S3_BUCKET")?,
        access_key_id: lire("S3_ACCESS_KEY_ID")?,
        secret_access_key: lire("S3_SECRET_ACCESS_KEY")?,
    })
}

fn parse_u64_env(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Couples (nom, valeur) de `.env.example` et `.env.development.example`.
/// Hors développement, une variable d'environnement égale à l'une de ces valeurs refuse le démarrage.
pub const SECRETS_PUBLIES: &[(&str, &str)] = &[
    (
        "POSTGRES_PASSWORD",
        "remplacer-mot-de-passe-fort-alphanumerique",
    ),
    (
        "DATABASE_URL",
        "postgresql://legalos:remplacer-mot-de-passe-fort-alphanumerique@localhost:5432/legalos",
    ),
    (
        "SECRETS_CHIFFREMENT_KEY",
        "legalos_example_key_32_bytes!!!!",
    ),
    (
        "SECRETS_CHIFFREMENT_KEY",
        "legalos_demo_chiffrement_32oct!!",
    ),
    (
        "PS_DATA_SOURCE_URI",
        "postgresql://powersync_replication:remplacer-mot-de-passe-fort-alphanumerique@postgres:5432/legalos",
    ),
    (
        "PS_STORAGE_URI",
        "postgresql://legalos:remplacer-mot-de-passe-fort-alphanumerique@postgres:5432/powersync_storage",
    ),
    (
        "GARAGE_RPC_SECRET",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ),
    (
        "GARAGE_ADMIN_TOKEN",
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    ),
    ("GREENMAIL_PASSWORD", "remplacer-mot-de-passe-mail-test"),
    ("LEGALOS_DEMO_PASSWORD", "MotDePasseDemo123!"),
    (
        "LEGALOS_DEMO_TOTP_SECRET_BASE32",
        "MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO",
    ),
];

/// Valeurs publiées de la clé de chiffrement. Conservé pour les tests d'installation.
pub const CLES_CHIFFREMENT_CONNUES: &[&str] = &[
    "legalos_example_key_32_bytes!!!!",
    "legalos_demo_chiffrement_32oct!!",
];

pub fn mode_developpement() -> bool {
    std::env::var("LEGALOS_MODE")
        .ok()
        .is_some_and(|v| v == "development")
}

pub fn valeur_secrete_publiee(nom: &str, valeur: &str) -> bool {
    let valeur = valeur.trim();
    !valeur.is_empty()
        && SECRETS_PUBLIES
            .iter()
            .any(|(n, publi)| *n == nom && *publi == valeur)
}

pub fn mot_de_passe_dans_url(url: &str) -> Option<&str> {
    let rest = url.trim().split_once("://")?.1;
    let userinfo = rest.split_once('@')?.0;
    Some(userinfo.split_once(':')?.1)
}

pub fn refuser_cle_connue_hors_developpement(raw: &str) -> anyhow::Result<()> {
    if mode_developpement() || !CLES_CHIFFREMENT_CONNUES.contains(&raw.trim()) {
        return Ok(());
    }
    anyhow::bail!(
        "SECRETS_CHIFFREMENT_KEY est une valeur de démonstration connue ; démarrage refusé hors LEGALOS_MODE=development"
    )
}

/// Refuse le démarrage si un secret de l'environnement vaut une valeur désormais publique.
pub fn refuser_secrets_publies_hors_developpement() -> anyhow::Result<()> {
    if mode_developpement() {
        return Ok(());
    }
    let mut noms = std::collections::BTreeSet::new();
    for (nom, _) in SECRETS_PUBLIES {
        noms.insert(*nom);
    }
    for nom in noms {
        let Ok(valeur) = std::env::var(nom) else {
            continue;
        };
        if valeur_secrete_publiee(nom, &valeur) {
            anyhow::bail!(
                "{nom} reprend une valeur publiée dans le dépôt ; démarrage refusé hors LEGALOS_MODE=development"
            );
        }
        if let Some(mot) = mot_de_passe_dans_url(&valeur) {
            if valeur_secrete_publiee("POSTGRES_PASSWORD", mot) {
                anyhow::bail!(
                    "{nom} contient un mot de passe publié ; démarrage refusé hors LEGALOS_MODE=development"
                );
            }
        }
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

    #[test]
    fn fichiers_exemple_sont_tous_refuses() {
        use super::valeur_secrete_publiee;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for nom_fichier in [".env.example", ".env.development.example"] {
            let texte = std::fs::read_to_string(root.join(nom_fichier)).expect(nom_fichier);
            for ligne in texte.lines() {
                if ligne.starts_with('#') || ligne.is_empty() {
                    continue;
                }
                let Some((cle, valeur)) = ligne.split_once('=') else {
                    continue;
                };
                if valeur.is_empty() || !est_ligne_secrete(cle) {
                    continue;
                }
                assert!(
                    valeur_secrete_publiee(cle, valeur),
                    "{nom_fichier} : {cle} absent du refus"
                );
            }
        }
    }

    fn est_ligne_secrete(cle: &str) -> bool {
        cle.ends_with("PASSWORD")
            || cle.ends_with("_SECRET")
            || cle.ends_with("_TOKEN")
            || cle == "SECRETS_CHIFFREMENT_KEY"
            || cle.contains("TOTP")
            || cle == "DATABASE_URL"
            || (cle.starts_with("PS_") && cle.ends_with("_URI"))
    }
}
