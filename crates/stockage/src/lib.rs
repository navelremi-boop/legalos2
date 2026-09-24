//! Accès aux fichiers via OpenDAL (implémentation S6).

use thiserror::Error;

#[derive(Debug, Error)]
pub enum StockageError {
    #[error("stockage non configuré")]
    NonConfigure,
}

/// Point d'entrée futur pour OpenDAL (S3, WebDAV, …).
#[derive(Debug, Default)]
pub struct StockageFichiers;

impl StockageFichiers {
    pub fn new() -> Self {
        Self
    }
}
