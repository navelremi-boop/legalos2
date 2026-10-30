//! Contrôles de la fiche d'annuaire, sans accès à la base.

use crate::error::ApiError;

const PROFESSIONS: &[&str] = &[
    "avocat",
    "commissaire_justice",
    "notaire",
    "expert_judiciaire",
    "administrateur_judiciaire",
    "mandataire_judiciaire",
    "expert_comptable",
    "commissaire_comptes",
];

pub fn valider_civilite(civilite: &str) -> Result<(), ApiError> {
    if civilite.trim().to_lowercase() == "mademoiselle" {
        return Err(ApiError::bad_request("Civilité non admise"));
    }
    Ok(())
}

pub fn valider_accord(accord: &str) -> Result<(), ApiError> {
    if accord != "masculin" && accord != "feminin" {
        return Err(ApiError::bad_request("Accord grammatical inconnu"));
    }
    Ok(())
}

pub fn valider_profession_reglementee(code: &str) -> Result<(), ApiError> {
    if !PROFESSIONS.contains(&code) {
        return Err(ApiError::bad_request("Profession réglementée inconnue"));
    }
    Ok(())
}

pub fn valider_date_naissance(date: &str) -> Result<(), ApiError> {
    let ok = date.len() == 10
        && date.as_bytes().get(4) == Some(&b'-')
        && date.as_bytes().get(7) == Some(&b'-')
        && date.as_bytes().iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    if !ok {
        return Err(ApiError::bad_request("Date de naissance invalide"));
    }
    Ok(())
}

pub fn valider_capital(centimes: i64) -> Result<(), ApiError> {
    if centimes < 0 {
        return Err(ApiError::bad_request("Capital invalide"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        valider_accord, valider_capital, valider_civilite, valider_date_naissance,
        valider_profession_reglementee,
    };

    #[test]
    fn mademoiselle_est_refusee() {
        assert!(valider_civilite("Mademoiselle").is_err());
        assert!(valider_civilite("Madame").is_ok());
        assert!(valider_civilite("Maître").is_ok());
    }

    #[test]
    fn accord_profession_date_et_capital() {
        assert!(valider_accord("feminin").is_ok());
        assert!(valider_accord("autre").is_err());
        assert!(valider_profession_reglementee("avocat").is_ok());
        assert!(valider_profession_reglementee("fax").is_err());
        assert!(valider_date_naissance("1980-03-14").is_ok());
        assert!(valider_date_naissance("14/03/1980").is_err());
        assert!(valider_capital(0).is_ok());
        assert!(valider_capital(-1).is_err());
    }
}
