use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use totp_rs::{Algorithm, Builder, Secret, Totp};

const NONCE_LEN: usize = 12;

/// Chiffrement à nonce fixe — **uniquement** pour la migration de démo fictive (004).
pub fn chiffrer_secret_totp_demo_fixe(plain: &[u8], key: &[u8; 32]) -> anyhow::Result<String> {
    chiffrer_avec_nonce(plain, key, b"legalos-demo")
}

pub fn chiffrer_secret_totp(plain: &[u8], key: &[u8; 32]) -> anyhow::Result<String> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    chiffrer_avec_nonce(plain, key, &nonce_bytes)
}

fn chiffrer_avec_nonce(
    plain: &[u8],
    key: &[u8; 32],
    nonce_bytes: &[u8; NONCE_LEN],
) -> anyhow::Result<String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| anyhow::anyhow!("clé AES invalide: {e}"))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain)
        .map_err(|e| anyhow::anyhow!("chiffrement TOTP: {e}"))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(B64.encode(out))
}

pub fn dechiffrer_secret_totp(stored: &str, key: &[u8; 32]) -> anyhow::Result<Vec<u8>> {
    let raw = B64
        .decode(stored.trim())
        .map_err(|e| anyhow::anyhow!("base64 secret TOTP: {e}"))?;
    if raw.len() <= NONCE_LEN {
        anyhow::bail!("secret TOTP chiffré trop court");
    }
    let (nonce_bytes, ciphertext) = raw.split_at(NONCE_LEN);
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| anyhow::anyhow!("clé AES invalide: {e}"))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("déchiffrement TOTP: {e}"))
}

pub fn verifier_code_totp(
    secret_base32: &str,
    account_name: &str,
    code: &str,
) -> anyhow::Result<bool> {
    let secret = Secret::try_from_base32(secret_base32)
        .map_err(|e| anyhow::anyhow!("secret TOTP invalide: {e}"))?;
    let totp: Totp = Builder::new()
        .with_secret(secret.as_bytes().to_vec())
        .with_algorithm(Algorithm::SHA1)
        .with_account_name(account_name)
        .with_issuer(Some("LEGAL OS"))
        .build()
        .map_err(|e| anyhow::anyhow!("config TOTP: {e}"))?;
    Ok(totp.check_current(code).is_some())
}
