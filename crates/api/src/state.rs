use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::jwt::JwtKeys;
use legalos_messagerie::{ParametresCompte, ParametresSmtp};
use legalos_stockage::StockageFichiers;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt: Arc<JwtKeys>,
    pub totp_cipher_key: [u8; 32],
    pub jwt_issuer: String,
    pub jwt_audience: String,
    pub access_token_ttl_secs: u64,
    pub session_token_ttl_secs: u64,
    pub refresh_token_ttl_secs: u64,
    pub stockage: Option<StockageFichiers>,
    /// Compte IMAP de la boîte de classement (jamais exposé au poste).
    pub messagerie: Option<ParametresCompte>,
    /// SMTP de la file d'envoi (même hôte GreenMail en test).
    pub messagerie_smtp: Option<ParametresSmtp>,
}
