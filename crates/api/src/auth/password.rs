use argon2::{
    password_hash::{PasswordHasher, PasswordVerifier},
    Argon2,
};
use password_hash::phc::PasswordHash;

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    let parsed = match PasswordHash::new(password_hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let hash = Argon2::default()
        .hash_password(password.as_bytes())
        .map_err(|e| anyhow::anyhow!("hash mot de passe: {e}"))?;
    Ok(hash.to_string())
}
