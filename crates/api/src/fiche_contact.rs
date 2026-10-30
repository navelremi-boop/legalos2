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

const SITUATIONS_FAMILIALES: &[&str] = &["celibataire", "marie", "pacse", "divorce", "veuf"];

pub fn valider_situation_familiale(code: &str) -> Result<(), ApiError> {
    if !SITUATIONS_FAMILIALES.contains(&code) {
        return Err(ApiError::bad_request("Situation familiale inconnue"));
    }
    Ok(())
}

const GENRES_COORDONNEE: &[&str] = &["adresse", "telephone", "email", "site"];
const USAGES_COORDONNEE: &[&str] = &[
    "domicile",
    "siege",
    "correspondance",
    "facturation",
    "cabinet",
    "etude",
    "autre",
];

pub fn valider_genre_coordonnee(genre: &str) -> Result<(), ApiError> {
    if !GENRES_COORDONNEE.contains(&genre) {
        return Err(ApiError::bad_request("Genre de coordonnée inconnu"));
    }
    Ok(())
}

pub fn controler_rattachement(soi: bool, meme_dossier: bool, admet: bool) -> Result<(), ApiError> {
    if soi {
        return Err(ApiError::bad_request(
            "Un intervenant ne se rattache pas à lui-même",
        ));
    }
    if !meme_dossier {
        return Err(ApiError::bad_request(
            "Le rattachement vise un autre dossier",
        ));
    }
    if !admet {
        return Err(ApiError::bad_request(
            "Cette qualité n'admet pas de rattachement",
        ));
    }
    Ok(())
}

pub fn valider_usage_coordonnee(usage: &str) -> Result<(), ApiError> {
    if !USAGES_COORDONNEE.contains(&usage) {
        return Err(ApiError::bad_request("Type de coordonnée inconnu"));
    }
    Ok(())
}

const TYPES_LIEN: &[&str] = &[
    "mandat_social",
    "representant_permanent",
    "associe",
    "salarie",
    "conjoint_pacs",
    "parent",
    "expert_comptable",
    "commissaire_comptes",
    "autre",
];

const FONCTIONS_MANDAT: &[&str] = &[
    "gerant",
    "president",
    "directeur_general",
    "directeur_general_delegue",
    "administrateur",
    "membre_directoire",
    "membre_conseil_surveillance",
    "liquidateur_amiable",
];

pub fn valider_lien(
    type_lien: &str,
    fonction: Option<&str>,
    libelle: Option<&str>,
    debut: Option<&str>,
    fin: Option<&str>,
    represente: bool,
) -> Result<(), ApiError> {
    if !TYPES_LIEN.contains(&type_lien) {
        return Err(ApiError::bad_request("Type de lien inconnu"));
    }
    if type_lien == "mandat_social" {
        let fonction = fonction.unwrap_or("").trim();
        if !FONCTIONS_MANDAT.contains(&fonction) {
            return Err(ApiError::bad_request("Fonction de mandat inconnue"));
        }
    }
    if type_lien == "autre" && libelle.unwrap_or("").trim().is_empty() {
        return Err(ApiError::bad_request("Libellé du lien requis"));
    }
    if represente && type_lien != "mandat_social" {
        return Err(ApiError::bad_request(
            "Seul un mandat social représente la société",
        ));
    }
    if let Some(fin) = fin.map(str::trim).filter(|s| !s.is_empty()) {
        let debut = debut.unwrap_or("").trim();
        if debut.is_empty() || fin <= debut {
            return Err(ApiError::bad_request(
                "La fin doit être postérieure au début",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        controler_rattachement, valider_accord, valider_capital, valider_civilite,
        valider_date_naissance, valider_genre_coordonnee, valider_lien,
        valider_profession_reglementee, valider_situation_familiale, valider_usage_coordonnee,
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
        assert!(valider_situation_familiale("marie").is_ok());
        assert!(valider_situation_familiale("celibataire").is_ok());
        assert!(valider_situation_familiale("inconnu").is_err());
        assert!(valider_genre_coordonnee("adresse").is_ok());
        assert!(valider_genre_coordonnee("fax").is_err());
        assert!(valider_usage_coordonnee("domicile").is_ok());
        assert!(valider_usage_coordonnee("fax").is_err());
        assert!(controler_rattachement(true, true, true).is_err());
        assert!(controler_rattachement(false, false, true).is_err());
        assert!(controler_rattachement(false, true, false).is_err());
        assert!(controler_rattachement(false, true, true).is_ok());
        assert!(valider_lien(
            "mandat_social",
            Some("president"),
            None,
            Some("2020-01-01"),
            None,
            true
        )
        .is_ok());
        assert!(valider_lien(
            "mandat_social",
            Some("president"),
            None,
            Some("2024-01-01"),
            Some("2020-01-01"),
            false
        )
        .is_err());
        assert!(valider_lien("autre", None, None, None, None, false).is_err());
        assert!(valider_lien("salarie", None, None, None, None, true).is_err());
    }
}
