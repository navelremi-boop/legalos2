//! Fichiers via OpenDAL vers Garage (S3).

use std::time::Duration;

use opendal::services::S3;
use opendal::Operator;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StockageError {
    #[error("stockage non configuré")]
    NonConfigure,
    #[error("stockage : {0}")]
    OpenDal(#[from] opendal::Error),
}

#[derive(Clone)]
pub struct StockageFichiers {
    interne: Operator,
    public: Operator,
}

pub struct ParametresS3 {
    pub endpoint_interne: String,
    pub endpoint_public: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl StockageFichiers {
    pub fn connecter(parametres: &ParametresS3) -> Result<Self, StockageError> {
        opendal::install_default();
        Ok(Self {
            interne: operateur(&parametres.endpoint_interne, parametres)?,
            public: operateur(&parametres.endpoint_public, parametres)?,
        })
    }

    pub async fn url_depot(&self, cle: &str) -> Result<String, StockageError> {
        let requete = self
            .public
            .presign_write(cle, Duration::from_secs(600))
            .await?;
        Ok(requete.uri().to_string())
    }

    pub async fn url_lecture(&self, cle: &str) -> Result<String, StockageError> {
        let requete = self
            .public
            .presign_read(cle, Duration::from_secs(600))
            .await?;
        Ok(requete.uri().to_string())
    }

    pub async fn lire(&self, cle: &str) -> Result<Vec<u8>, StockageError> {
        Ok(self.interne.read(cle).await?.to_vec())
    }
}

fn operateur(endpoint: &str, parametres: &ParametresS3) -> Result<Operator, StockageError> {
    let builder = S3::default()
        .endpoint(endpoint)
        .region(&parametres.region)
        .bucket(&parametres.bucket)
        .access_key_id(&parametres.access_key_id)
        .secret_access_key(&parametres.secret_access_key)
        .disable_config_load()
        .disable_ec2_metadata();
    Ok(Operator::new(builder)?)
}
