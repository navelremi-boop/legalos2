//! Interrogation du registre public Recherche d'entreprises.
//! L'instance appelle le service ; le poste ne le contacte jamais.
//! URL, limite et date : `docs/versions.md`.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};
use utoipa::ToSchema;

use crate::error::ApiError;

pub const URL_RECHERCHE: &str = "https://recherche-entreprises.api.gouv.fr/search";
pub const DELAI_SECONDES: u64 = 10;
const CACHE: Duration = Duration::hours(24);
const SOURCE: &str = "recherche-entreprises";

const MSG_INDISPONIBLE: &str =
    "Le registre des entreprises est indisponible. La saisie manuelle reste possible.";
const MSG_INCONNU: &str = "SIREN inconnu du registre.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PropositionSiren {
    pub siren: String,
    pub denomination: Option<String>,
    pub forme: Option<String>,
    pub adresse_siege: Option<String>,
    pub activite: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReponseRegistre {
    results: Vec<EntrepriseRegistre>,
}

#[derive(Debug, Deserialize)]
struct EntrepriseRegistre {
    siren: String,
    nom_complet: Option<String>,
    nom_raison_sociale: Option<String>,
    nature_juridique: Option<String>,
    activite_principale: Option<String>,
    siege: Option<SiegeRegistre>,
}

#[derive(Debug, Deserialize)]
struct SiegeRegistre {
    adresse: Option<String>,
}

pub struct CacheRegistre {
    entrees: Mutex<HashMap<String, (OffsetDateTime, PropositionSiren)>>,
}

impl CacheRegistre {
    pub fn new() -> Self {
        Self {
            entrees: Mutex::new(HashMap::new()),
        }
    }

    fn verrou(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, (OffsetDateTime, PropositionSiren)>> {
        self.entrees.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn lire(&self, siren: &str, maintenant: OffsetDateTime) -> Option<PropositionSiren> {
        let gardien = self.verrou();
        let (expire, proposition) = gardien.get(siren)?;
        if *expire <= maintenant {
            return None;
        }
        Some(proposition.clone())
    }

    pub fn ecrire(&self, siren: &str, proposition: PropositionSiren, maintenant: OffsetDateTime) {
        self.verrou()
            .insert(siren.to_owned(), (maintenant + CACHE, proposition));
    }
}

impl Default for CacheRegistre {
    fn default() -> Self {
        Self::new()
    }
}

pub fn source_import() -> &'static str {
    SOURCE
}

fn chiffres(brut: &str) -> String {
    brut.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn texte_utile(valeur: Option<String>) -> Option<String> {
    valeur
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

pub fn proposition_depuis_json(
    corps: &serde_json::Value,
    siren: &str,
) -> Result<PropositionSiren, ApiError> {
    let reponse: ReponseRegistre =
        serde_json::from_value(corps.clone()).map_err(|_| indisponible())?;
    let entreprise = reponse
        .results
        .into_iter()
        .find(|ligne| chiffres(&ligne.siren) == siren)
        .ok_or_else(|| ApiError::not_found(MSG_INCONNU))?;
    let denomination =
        texte_utile(entreprise.nom_raison_sociale).or_else(|| texte_utile(entreprise.nom_complet));
    let adresse = entreprise
        .siege
        .and_then(|siege| texte_utile(siege.adresse));
    Ok(PropositionSiren {
        siren: siren.to_owned(),
        denomination,
        forme: texte_utile(entreprise.nature_juridique),
        adresse_siege: adresse,
        activite: texte_utile(entreprise.activite_principale),
    })
}

fn indisponible() -> ApiError {
    ApiError::with_code(
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
        "registre_indisponible",
        MSG_INDISPONIBLE,
    )
}

pub fn marquer_indisponible() -> ApiError {
    indisponible()
}

/// SIREN normalisé, ou erreur avant tout appel au registre.
pub fn preparer_siren(brut: &str) -> Result<String, ApiError> {
    crate::identifiants::verifier_siren_tva(Some(brut), None)?;
    let siren = chiffres(brut);
    if siren.len() != 9 {
        return Err(ApiError::bad_request("SIREN invalide."));
    }
    Ok(siren)
}

/// Cache de 24 h. Le chargeur n'est appelé qu'en cas d'absence.
pub async fn resoudre<F, Fut>(
    cache: &CacheRegistre,
    brut: &str,
    maintenant: OffsetDateTime,
    charger: F,
) -> Result<PropositionSiren, ApiError>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<serde_json::Value, ApiError>>,
{
    let siren = preparer_siren(brut)?;
    if let Some(deja) = cache.lire(&siren, maintenant) {
        return Ok(deja);
    }
    let corps = charger(siren.clone()).await?;
    let proposition = proposition_depuis_json(&corps, &siren)?;
    cache.ecrire(&siren, proposition.clone(), maintenant);
    Ok(proposition)
}

pub async fn interroger_http(siren: &str) -> Result<serde_json::Value, ApiError> {
    let url =
        format!("{URL_RECHERCHE}?q=siren:{siren}&per_page=1&page=1&minimal=true&include=siege");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DELAI_SECONDES))
        .build()
        .map_err(|_| indisponible())?;
    let reponse = client
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|_| indisponible())?;
    if !reponse.status().is_success() {
        return Err(indisponible());
    }
    reponse.json().await.map_err(|_| indisponible())
}

pub fn cache_partage() -> &'static CacheRegistre {
    use std::sync::OnceLock;
    static CACHE_PARTAGE: OnceLock<CacheRegistre> = OnceLock::new();
    CACHE_PARTAGE.get_or_init(CacheRegistre::new)
}

#[cfg(test)]
mod tests {
    use super::{preparer_siren, proposition_depuis_json, resoudre, CacheRegistre};
    use time::OffsetDateTime;

    fn fixture() -> serde_json::Value {
        serde_json::json!({
            "results": [{
                "siren": "130025265",
                "nom_complet": "DIRECTION INTERMINISTERIELLE DU NUMERIQUE (DINUM)",
                "nom_raison_sociale": "DIRECTION INTERMINISTERIELLE DU NUMERIQUE",
                "nature_juridique": "7120",
                "activite_principale": "84.11Z",
                "siege": { "adresse": "20 AVENUE DE SEGUR 75007 PARIS" }
            }]
        })
    }

    #[test]
    fn un_siren_invalide_n_appelle_pas_le_registre() {
        assert!(preparer_siren("123456789").is_err());
        let normalise = preparer_siren("100 000 009");
        assert!(normalise.is_ok());
        if let Ok(siren) = normalise {
            assert_eq!(siren, "100000009");
        }
    }

    #[test]
    fn la_proposition_reprend_denomination_forme_siege_et_activite() {
        let resultat = proposition_depuis_json(&fixture(), "130025265");
        assert!(resultat.is_ok());
        if let Ok(proposition) = resultat {
            assert_eq!(
                proposition.denomination.as_deref(),
                Some("DIRECTION INTERMINISTERIELLE DU NUMERIQUE")
            );
            assert_eq!(proposition.forme.as_deref(), Some("7120"));
            assert_eq!(
                proposition.adresse_siege.as_deref(),
                Some("20 AVENUE DE SEGUR 75007 PARIS")
            );
            assert_eq!(proposition.activite.as_deref(), Some("84.11Z"));
        }
    }

    #[test]
    fn un_siren_absent_est_inconnu() {
        let json = serde_json::json!({ "results": [] });
        let err = proposition_depuis_json(&json, "100000009");
        assert!(err.is_err());
        if let Err(err) = err {
            assert_eq!(err.status(), axum::http::StatusCode::NOT_FOUND);
        }
    }

    #[tokio::test]
    async fn le_cache_evite_un_second_appel_et_une_panne_n_est_pas_memorisee() {
        let cache = CacheRegistre::new();
        let instant = OffsetDateTime::from_unix_timestamp(1_700_000_000);
        assert!(instant.is_ok());
        let Some(maintenant) = instant.ok() else {
            return;
        };
        let appels = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let compteur = appels.clone();
        let premiere = resoudre(&cache, "130025265", maintenant, move |_siren| {
            compteur.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { Ok(fixture()) }
        })
        .await;
        assert!(premiere.is_ok());
        let seconde = resoudre(&cache, "130025265", maintenant, |_siren| async {
            Ok(serde_json::json!({ "results": [] }))
        })
        .await;
        assert!(seconde.is_ok());
        if let (Ok(a), Ok(b)) = (premiere, seconde) {
            assert_eq!(a, b);
        }
        assert_eq!(appels.load(std::sync::atomic::Ordering::SeqCst), 1);

        let panne = resoudre(&cache, "100000009", maintenant, |_siren| async {
            Err(super::marquer_indisponible())
        })
        .await;
        assert!(panne.is_err());
        if let Err(err) = panne {
            assert_eq!(err.status(), axum::http::StatusCode::SERVICE_UNAVAILABLE);
        }
        assert!(cache.lire("100000009", maintenant).is_none());
    }
}
