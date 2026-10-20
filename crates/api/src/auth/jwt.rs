use aws_lc_rs::encoding::AsDer;
use aws_lc_rs::rsa::{KeyPair as RsaKeyPair, KeySize, PublicKeyComponents};
use aws_lc_rs::signature::KeyPair as _;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const DEBUT_PEM: &str = "-----BEGIN PRIVATE KEY-----";
const FIN_PEM: &str = "-----END PRIVATE KEY-----";

/// Clé de signature RS256 des jetons. L'identifiant de clé (`kid`) est l'empreinte RFC 7638 de la clé publique :
/// une autre clé a toujours un autre `kid`, et PowerSync ne peut pas garder en cache l'ancienne sous le même nom.
#[derive(Clone)]
pub struct JwtKeys {
    pub kid: String,
    n: String,
    e: String,
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl JwtKeys {
    /// Clé privée PKCS#8, en PEM ou en PEM encodé en base64 (une seule ligne, pour un fichier `.env`).
    pub fn from_rsa_pem(valeur: &str) -> anyhow::Result<Self> {
        let pem = pem_depuis_valeur(valeur)?;
        let der = pkcs8_depuis_pem(&pem)?;
        let paire = RsaKeyPair::from_pkcs8(&der)
            .map_err(|e| anyhow::anyhow!("clé de signature refusée : {e}"))?;
        let composantes = PublicKeyComponents::<Vec<u8>>::from(paire.public_key());
        let n = URL_SAFE_NO_PAD.encode(&composantes.n);
        let e = URL_SAFE_NO_PAD.encode(&composantes.e);
        Ok(Self {
            kid: empreinte_jwk(&n, &e),
            encoding: EncodingKey::from_rsa_pem(pem.as_bytes())?,
            decoding: DecodingKey::from_rsa_components(&n, &e)?,
            n,
            e,
        })
    }

    /// Nouvelle clé RSA 2048 bits et son PEM PKCS#8 (à conserver par l'appelant si elle doit survivre au processus).
    pub fn generer() -> anyhow::Result<(Self, String)> {
        let paire = RsaKeyPair::generate(KeySize::Rsa2048)
            .map_err(|_| anyhow::anyhow!("génération de la clé de signature"))?;
        let der = paire
            .as_der()
            .map_err(|_| anyhow::anyhow!("export de la clé de signature"))?;
        let pem = pem_depuis_pkcs8(der.as_ref());
        Ok((Self::from_rsa_pem(&pem)?, pem))
    }

    /// Nouvelle clé de signature, PEM encodé en base64 sur une seule ligne : la valeur de `JWT_RSA_PRIVATE_KEY_PEM`
    /// que l'installation écrit dans le `.env` de production.
    pub fn generer_pour_env() -> anyhow::Result<String> {
        let (_, pem) = Self::generer()?;
        Ok(STANDARD.encode(pem.as_bytes()))
    }

    pub fn jwks_json(&self) -> serde_json::Value {
        serde_json::json!({
            "keys": [{
                "kty": "RSA",
                "kid": self.kid,
                "use": "sig",
                "alg": "RS256",
                "n": self.n,
                "e": self.e
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

    pub fn decode_access(
        &self,
        issuer: &str,
        audience: &str,
        token: &str,
    ) -> anyhow::Result<AccessClaims> {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[issuer]);
        validation.set_audience(&[audience]);
        validation.set_required_spec_claims(&["exp", "iat", "sub", "aud"]);
        let data = decode::<AccessClaims>(token, &self.decoding, &validation)
            .map_err(|e| anyhow::anyhow!("access JWT: {e}"))?;
        if data.claims.token_type != "access" {
            anyhow::bail!("type de jeton d'accès invalide");
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

/// Empreinte d'une clé publique RSA (RFC 7638) : SHA-256 du JSON canonique `{"e","kty","n"}`.
fn empreinte_jwk(n: &str, e: &str) -> String {
    let canonique = format!(r#"{{"e":"{e}","kty":"RSA","n":"{n}"}}"#);
    URL_SAFE_NO_PAD.encode(Sha256::digest(canonique.as_bytes()))
}

/// PEM brut (les `\n` littéraux d'une variable d'environnement sont acceptés) ou PEM encodé en base64.
fn pem_depuis_valeur(valeur: &str) -> anyhow::Result<String> {
    let valeur = valeur.trim();
    if valeur.starts_with("-----BEGIN") {
        return Ok(valeur.replace("\\n", "\n"));
    }
    let compact: String = valeur.split_whitespace().collect();
    let octets = STANDARD
        .decode(compact)
        .map_err(|_| anyhow::anyhow!("clé de signature : ni PEM ni PEM en base64"))?;
    String::from_utf8(octets).map_err(|_| anyhow::anyhow!("clé de signature : PEM illisible"))
}

fn pkcs8_depuis_pem(pem: &str) -> anyhow::Result<Vec<u8>> {
    if !pem.contains(DEBUT_PEM) || !pem.contains(FIN_PEM) {
        anyhow::bail!("clé de signature : un PEM PKCS#8 (« BEGIN PRIVATE KEY ») est attendu");
    }
    let corps: String = pem
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("-----"))
        .collect();
    STANDARD
        .decode(corps)
        .map_err(|_| anyhow::anyhow!("clé de signature : PEM PKCS#8 illisible"))
}

fn pem_depuis_pkcs8(der: &[u8]) -> String {
    let base64 = STANDARD.encode(der);
    let mut pem = String::from(DEBUT_PEM);
    for ligne in base64.as_bytes().chunks(64) {
        pem.push('\n');
        pem.push_str(&String::from_utf8_lossy(ligne));
    }
    pem.push('\n');
    pem.push_str(FIN_PEM);
    pem.push('\n');
    pem
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn une_cle_generee_se_relit_avec_le_meme_kid() {
        let (cle, pem) = JwtKeys::generer().expect("génération");
        let relue = JwtKeys::from_rsa_pem(&pem).expect("relecture");
        assert_eq!(cle.kid, relue.kid);
        assert_eq!(cle.jwks_json(), relue.jwks_json());
    }

    #[test]
    fn le_kid_suit_la_cle() {
        let (a, _) = JwtKeys::generer().expect("clé a");
        let (b, _) = JwtKeys::generer().expect("clé b");
        assert_ne!(a.kid, b.kid, "deux clés ne partagent jamais un kid");
        assert_eq!(a.kid.len(), 43, "empreinte SHA-256 en base64url");
    }

    #[test]
    fn le_pem_en_base64_et_les_retours_litteraux_sont_acceptes() {
        let (cle, pem) = JwtKeys::generer().expect("génération");
        let en_base64 = STANDARD.encode(pem.as_bytes());
        assert_eq!(
            JwtKeys::from_rsa_pem(&en_base64).expect("base64").kid,
            cle.kid
        );
        let sur_une_ligne = pem.trim().replace('\n', "\\n");
        assert_eq!(
            JwtKeys::from_rsa_pem(&sur_une_ligne).expect("\\n").kid,
            cle.kid
        );
    }

    #[test]
    fn une_valeur_qui_n_est_pas_une_cle_est_refusee() {
        assert!(JwtKeys::from_rsa_pem("").is_err());
        assert!(JwtKeys::from_rsa_pem("pas une clé").is_err());
        assert!(JwtKeys::from_rsa_pem(
            "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"
        )
        .is_err());
        assert!(JwtKeys::from_rsa_pem(&pem_depuis_pkcs8(b"pas du DER")).is_err());
    }

    #[test]
    fn un_jeton_signe_se_relit_et_une_autre_cle_le_refuse() {
        let (cle, _) = JwtKeys::generer().expect("clé");
        let (autre, _) = JwtKeys::generer().expect("autre clé");
        let (u, c, p) = (Uuid::nil(), Uuid::nil(), Uuid::nil());
        let jeton = cle
            .sign_access("emetteur", "public", u, c, p, 60)
            .expect("signature");
        let claims = cle
            .decode_access("emetteur", "public", &jeton)
            .expect("lecture");
        assert_eq!(claims.sub, u);
        assert!(autre.decode_access("emetteur", "public", &jeton).is_err());
    }
}
