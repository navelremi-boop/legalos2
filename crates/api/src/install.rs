use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::password::hash_password;
use crate::auth::totp::chiffrer_secret_totp;
use crate::db::appliquer_migrations;

pub const EMAIL_ADMIN: &str = "admin@cabinet.example";

pub struct AdministrateurCree {
    pub email: String,
    pub mot_de_passe: String,
    pub secret_totp_base32: String,
}

pub async fn creer_premier_administrateur(
    pool: &PgPool,
    cle: &[u8; 32],
    mot_de_passe: &str,
    secret_totp_base32: &str,
) -> anyhow::Result<AdministrateurCree> {
    appliquer_migrations(pool).await?;
    let comptes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM utilisateurs")
        .fetch_one(pool)
        .await?;
    if comptes > 0 {
        anyhow::bail!("un compte existe déjà ; installation refusée");
    }
    let hash = hash_password(mot_de_passe)?;
    let chiffre = chiffrer_secret_totp(secret_totp_base32.as_bytes(), cle)?;
    let cabinet = Uuid::now_v7();
    let user = Uuid::now_v7();
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, $3, TRUE)")
        .bind(cabinet)
        .bind(format!("cabinet-{cabinet}"))
        .bind("Cabinet")
        .execute(pool)
        .await?;
    sqlx::query(
        r#"INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif)
           VALUES ($1, $2, $3, $4, $5, TRUE)"#,
    )
    .bind(user)
    .bind(cabinet)
    .bind(EMAIL_ADMIN)
    .bind(hash)
    .bind(chiffre)
    .execute(pool)
    .await?;
    Ok(AdministrateurCree {
        email: EMAIL_ADMIN.to_owned(),
        mot_de_passe: mot_de_passe.to_owned(),
        secret_totp_base32: secret_totp_base32.to_owned(),
    })
}

pub fn uri_otpauth(email: &str, secret_base32: &str) -> String {
    format!(
        "otpauth://totp/LEGAL%20OS:{email}?secret={secret_base32}&issuer=LEGAL%20OS&algorithm=SHA1&digits=6&period=30"
    )
}
