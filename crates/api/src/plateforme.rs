//! Connecteur plateforme agréée derrière l'interface `PlateformeAgreee`.
//! Première implémentation HTTP (simulateur SUPER PDP / PA réelle via `PA_BASE_URL`).

use serde::{Deserialize, Serialize};

/// Erreur d'appel à la plateforme agréée (pas de détail métier dans les journaux).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErreurPlateforme {
    Indisponible,
    Refusee,
    Absente,
}

/// Dépôt d'une facture électronique (Factur-X) sur la PA.
#[derive(Debug, Clone, Serialize)]
pub struct DepotFacture {
    pub reference: String,
    pub numero: Option<i64>,
    pub montant_ttc_centimes: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DepotResultat {
    pub id: String,
}

/// Envoi du statut « encaissée » (total ou partiel) avec le montant.
#[derive(Debug, Clone, Serialize)]
pub struct EncaissementPa {
    pub reference: String,
    pub montant_centimes: i64,
    pub taux_tva_bp: i32,
    pub montant_ttc_centimes: i64,
}

/// Contrat cahier § 3.7 / règle 31 : dépôt, e-reporting, statuts, encaissement, annuaire.
pub trait PlateformeAgreee: Send + Sync {
    fn deposer(
        &self,
        cle_idempotence: &str,
        depot: DepotFacture,
    ) -> impl std::future::Future<Output = Result<DepotResultat, ErreurPlateforme>> + Send;

    fn envoyer_encaissement(
        &self,
        cle_idempotence: &str,
        enc: EncaissementPa,
    ) -> impl std::future::Future<Output = Result<(), ErreurPlateforme>> + Send;

    fn lire_statuts(
        &self,
        reference: &str,
    ) -> impl std::future::Future<Output = Result<serde_json::Value, ErreurPlateforme>> + Send;

    fn e_reporter(
        &self,
        cle_idempotence: &str,
        payload: serde_json::Value,
    ) -> impl std::future::Future<Output = Result<(), ErreurPlateforme>> + Send;

    fn interroger_annuaire(
        &self,
        siren: &str,
    ) -> impl std::future::Future<Output = Result<serde_json::Value, ErreurPlateforme>> + Send;
}

/// Client HTTP idempotent vers le simulateur ou une PA réelle.
pub struct HttpPlateformeAgreee {
    base_url: String,
    client: reqwest::Client,
}

impl HttpPlateformeAgreee {
    pub fn depuis_env() -> Result<Self, ErreurPlateforme> {
        let base_url = std::env::var("PA_BASE_URL").map_err(|_| ErreurPlateforme::Absente)?;
        Ok(Self {
            base_url,
            client: reqwest::Client::new(),
        })
    }
}

impl PlateformeAgreee for HttpPlateformeAgreee {
    async fn deposer(
        &self,
        cle_idempotence: &str,
        depot: DepotFacture,
    ) -> Result<DepotResultat, ErreurPlateforme> {
        let reponse = self
            .client
            .post(format!("{}/v1/factures/deposer", self.base_url))
            .header("idempotency-key", cle_idempotence)
            .json(&depot)
            .send()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)?;
        if !reponse.status().is_success() {
            return Err(ErreurPlateforme::Refusee);
        }
        reponse
            .json::<DepotResultat>()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)
    }

    async fn envoyer_encaissement(
        &self,
        cle_idempotence: &str,
        enc: EncaissementPa,
    ) -> Result<(), ErreurPlateforme> {
        let reponse = self
            .client
            .post(format!("{}/v1/encaissements", self.base_url))
            .header("idempotency-key", cle_idempotence)
            .json(&enc)
            .send()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)?;
        if !reponse.status().is_success() {
            return Err(ErreurPlateforme::Refusee);
        }
        Ok(())
    }

    async fn lire_statuts(
        &self,
        reference: &str,
    ) -> Result<serde_json::Value, ErreurPlateforme> {
        let reponse = self
            .client
            .get(format!(
                "{}/v1/factures/{}/statuts",
                self.base_url, reference
            ))
            .send()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)?;
        if !reponse.status().is_success() {
            return Err(ErreurPlateforme::Refusee);
        }
        reponse
            .json()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)
    }

    async fn e_reporter(
        &self,
        cle_idempotence: &str,
        payload: serde_json::Value,
    ) -> Result<(), ErreurPlateforme> {
        let reponse = self
            .client
            .post(format!("{}/v1/e-reporting", self.base_url))
            .header("idempotency-key", cle_idempotence)
            .json(&payload)
            .send()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)?;
        if !reponse.status().is_success() {
            return Err(ErreurPlateforme::Refusee);
        }
        Ok(())
    }

    async fn interroger_annuaire(
        &self,
        siren: &str,
    ) -> Result<serde_json::Value, ErreurPlateforme> {
        let reponse = self
            .client
            .get(format!("{}/v1/annuaire/{}", self.base_url, siren))
            .send()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)?;
        if !reponse.status().is_success() {
            return Err(ErreurPlateforme::Refusee);
        }
        reponse
            .json()
            .await
            .map_err(|_| ErreurPlateforme::Indisponible)
    }
}

#[cfg(test)]
#[allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::{DepotFacture, EncaissementPa, ErreurPlateforme, PlateformeAgreee};
    use std::sync::Mutex;

    struct PaMemoire {
        depots: Mutex<std::collections::HashMap<String, String>>,
        encaissements: Mutex<Vec<(String, i64)>>,
    }

    impl PlateformeAgreee for PaMemoire {
        async fn deposer(
            &self,
            cle_idempotence: &str,
            depot: DepotFacture,
        ) -> Result<super::DepotResultat, ErreurPlateforme> {
            let Ok(mut map) = self.depots.lock() else {
                return Err(ErreurPlateforme::Indisponible);
            };
            if let Some(id) = map.get(cle_idempotence) {
                return Ok(super::DepotResultat { id: id.clone() });
            }
            let id = format!("pa-{}", map.len() + 1);
            map.insert(cle_idempotence.to_owned(), id.clone());
            let _ = depot;
            Ok(super::DepotResultat { id })
        }

        async fn envoyer_encaissement(
            &self,
            cle_idempotence: &str,
            enc: EncaissementPa,
        ) -> Result<(), ErreurPlateforme> {
            let Ok(mut liste) = self.encaissements.lock() else {
                return Err(ErreurPlateforme::Indisponible);
            };
            liste.push((cle_idempotence.to_owned(), enc.montant_centimes));
            Ok(())
        }

        async fn lire_statuts(
            &self,
            _reference: &str,
        ) -> Result<serde_json::Value, ErreurPlateforme> {
            Ok(serde_json::json!({ "statut": "deposee" }))
        }

        async fn e_reporter(
            &self,
            _cle_idempotence: &str,
            _payload: serde_json::Value,
        ) -> Result<(), ErreurPlateforme> {
            Ok(())
        }

        async fn interroger_annuaire(
            &self,
            _siren: &str,
        ) -> Result<serde_json::Value, ErreurPlateforme> {
            Ok(serde_json::json!({ "siren": "123456789" }))
        }
    }

    #[tokio::test]
    async fn depot_idempotent_meme_cle() {
        let pa = PaMemoire {
            depots: Mutex::new(std::collections::HashMap::new()),
            encaissements: Mutex::new(Vec::new()),
        };
        let depot = DepotFacture {
            reference: "f1".into(),
            numero: Some(1),
            montant_ttc_centimes: 12_000,
        };
        let a = pa.deposer("cle-depot-1", depot.clone()).await;
        let b = pa.deposer("cle-depot-1", depot).await;
        assert!(a.is_ok());
        assert!(b.is_ok());
        assert_eq!(a.ok().map(|r| r.id), b.ok().map(|r| r.id));
        let Ok(map) = pa.depots.lock() else {
            panic!("mutex");
        };
        assert_eq!(map.len(), 1);
    }

    #[tokio::test]
    async fn encaissement_porte_le_montant() {
        let pa = PaMemoire {
            depots: Mutex::new(std::collections::HashMap::new()),
            encaissements: Mutex::new(Vec::new()),
        };
        let resultat = pa
            .envoyer_encaissement(
                "cle-enc-1",
                EncaissementPa {
                    reference: "f1".into(),
                    montant_centimes: 6_000,
                    taux_tva_bp: 2_000,
                    montant_ttc_centimes: 12_000,
                },
            )
            .await;
        assert!(resultat.is_ok());
        let Ok(liste) = pa.encaissements.lock() else {
            panic!("mutex");
        };
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].1, 6_000);
    }
}
