use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rsa::traits::PublicKeyParts;
use rsa::RsaPrivateKey;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone)]
pub struct JwtKeys {
    pub kid: String,
    private_key: Arc<RsaPrivateKey>,
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl JwtKeys {
    pub fn from_rsa_pem(pem: &[u8], kid: String) -> anyhow::Result<Self> {
        let private_key = RsaPrivateKey::from_pkcs8_pem(std::str::from_utf8(pem)?)?;
        let encoding = EncodingKey::from_rsa_pem(pem)?;
        let public_pem = private_key
            .to_public_key()
            .to_public_key_pem(LineEnding::LF)?;
        let decoding = DecodingKey::from_rsa_pem(public_pem.as_bytes())?;
        Ok(Self {
            kid,
            private_key: Arc::new(private_key),
            encoding,
            decoding,
        })
    }

    pub fn generate_ephemeral(kid: String) -> anyhow::Result<Self> {
        let mut rng = rand::rngs::OsRng;
        let private_key = RsaPrivateKey::new(&mut rng, 2048)?;
        let pem = private_key.to_pkcs8_pem(LineEnding::LF)?;
        Self::from_rsa_pem(pem.as_bytes(), kid)
    }

    pub fn private_key_pem(&self) -> anyhow::Result<String> {
        self.private_key
            .to_pkcs8_pem(LineEnding::LF)
            .map(|s| s.to_string())
            .map_err(|e| anyhow::anyhow!("export PEM: {e}"))
    }

    pub fn jwks_json(&self) -> serde_json::Value {
        let public = self.private_key.to_public_key();
        let n = URL_SAFE_NO_PAD.encode(public.n().to_bytes_be());
        let e = URL_SAFE_NO_PAD.encode(public.e().to_bytes_be());
        serde_json::json!({
            "keys": [{
                "kty": "RSA",
                "kid": self.kid,
                "use": "sig",
                "alg": "RS256",
                "n": n,
                "e": e
            }]
        })
    }

    pub fn sign_access(
        &self,
        issuer: &str,
        audience: &str,
        user_id: Uuid,
        cabinet_id: Uuid,
        poste_id: Uuid,
        ttl_secs: u64,
    ) -> anyhow::Result<String> {
        let claims = AccessClaims::new(issuer, audience, user_id, cabinet_id, poste_id, ttl_secs);
        self.sign(&claims, "access")
    }

    pub fn sign_session(
        &self,
        issuer: &str,
        user_id: Uuid,
        cabinet_id: Uuid,
        poste_id: Uuid,
        ttl_secs: u64,
    ) -> anyhow::Result<String> {
        let claims = SessionClaims::new(issuer, user_id, cabinet_id, poste_id, ttl_secs);
        self.sign(&claims, "totp_pending")
    }

    pub fn sign_refresh(
        &self,
        issuer: &str,
        user_id: Uuid,
        cabinet_id: Uuid,
        poste_id: Uuid,
        ttl_secs: u64,
    ) -> anyhow::Result<String> {
        let claims = RefreshClaims::new(issuer, user_id, cabinet_id, poste_id, ttl_secs);
        self.sign(&claims, "refresh")
    }

    fn sign<T: Serialize>(&self, claims: &T, typ: &str) -> anyhow::Result<String> {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(self.kid.clone());
        header.typ = Some(typ.into());
        encode(&header, claims, &self.encoding).map_err(|e| anyhow::anyhow!("JWT sign: {e}"))
    }

    pub fn decode_session(&self, issuer: &str, token: &str) -> anyhow::Result<SessionClaims> {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[issuer]);
        validation.set_required_spec_claims(&["exp", "iat", "sub"]);
        let data = decode::<SessionClaims>(token, &self.decoding, &validation)
            .map_err(|e| anyhow::anyhow!("session JWT: {e}"))?;
        if data.claims.token_type != "totp_pending" {
            anyhow::bail!("type de jeton session invalide");
        }
        Ok(data.claims)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccessClaims {
    pub sub: Uuid,
    pub cabinet_id: Uuid,
    pub poste_id: Uuid,
    pub iss: String,
    pub aud: String,
    pub exp: u64,
    pub iat: u64,
    #[serde(rename = "typ")]
    pub token_type: String,
}

impl AccessClaims {
    fn new(
        issuer: &str,
        audience: &str,
        user_id: Uuid,
        cabinet_id: Uuid,
        poste_id: Uuid,
        ttl_secs: u64,
    ) -> Self {
        let now = now_secs();
        Self {
            sub: user_id,
            cabinet_id,
            poste_id,
            iss: issuer.into(),
            aud: audience.into(),
            iat: now,
            exp: now + ttl_secs,
            token_type: "access".into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionClaims {
    pub sub: Uuid,
    pub cabinet_id: Uuid,
    pub poste_id: Uuid,
    pub iss: String,
    pub exp: u64,
    pub iat: u64,
    #[serde(rename = "typ")]
    pub token_type: String,
}

impl SessionClaims {
    fn new(issuer: &str, user_id: Uuid, cabinet_id: Uuid, poste_id: Uuid, ttl_secs: u64) -> Self {
        let now = now_secs();
        Self {
            sub: user_id,
            cabinet_id,
            poste_id,
            iss: issuer.into(),
            iat: now,
            exp: now + ttl_secs,
            token_type: "totp_pending".into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshClaims {
    pub sub: Uuid,
    pub cabinet_id: Uuid,
    pub poste_id: Uuid,
    pub iss: String,
    pub exp: u64,
    pub iat: u64,
    #[serde(rename = "typ")]
    pub token_type: String,
}

impl RefreshClaims {
    fn new(issuer: &str, user_id: Uuid, cabinet_id: Uuid, poste_id: Uuid, ttl_secs: u64) -> Self {
        let now = now_secs();
        Self {
            sub: user_id,
            cabinet_id,
            poste_id,
            iss: issuer.into(),
            iat: now,
            exp: now + ttl_secs,
            token_type: "refresh".into(),
        }
    }
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(_) => 0,
    }
}
