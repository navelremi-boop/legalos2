//! SIREN (clé de Luhn) et n° de TVA intracommunautaire FR.
//! Formule de clé retenue dans PLAN.md : `(12 + 3 × (SIREN mod 97)) mod 97`.

use crate::error::ApiError;

const MSG_SIREN: &str = "SIREN invalide.";
const MSG_TVA: &str = "Numéro de TVA invalide.";

fn chiffres(brut: &str) -> String {
    brut.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn luhn_valide(chiffres: &str) -> bool {
    if chiffres.len() != 9 || !chiffres.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let mut somme: u32 = 0;
    let mut doubler = false;
    for car in chiffres.chars().rev() {
        let mut n = u32::from(car as u8 - b'0');
        if doubler {
            n *= 2;
            if n > 9 {
                n -= 9;
            }
        }
        somme += n;
        doubler = !doubler;
    }
    somme % 10 == 0
}

fn cle_tva(siren: &str) -> Option<u32> {
    let n: u64 = siren.parse().ok()?;
    Some((12 + 3 * (n % 97)) as u32 % 97)
}

/// `FR` + clé sur deux chiffres + SIREN. Les espaces sont ignorés.
fn tva_fr(brut: &str) -> Option<(u32, String)> {
    let compact: String = brut.chars().filter(|c| !c.is_whitespace()).collect();
    let reste = compact
        .strip_prefix("FR")
        .or_else(|| compact.strip_prefix("fr"))?;
    if reste.len() != 11 || !reste.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let cle: u32 = reste[..2].parse().ok()?;
    let siren = reste[2..].to_owned();
    Some((cle, siren))
}

pub fn verifier_siren_tva(siren: Option<&str>, tva: Option<&str>) -> Result<(), ApiError> {
    let siren_chiffres = siren.map(str::trim).filter(|s| !s.is_empty()).map(chiffres);
    if let Some(ref s) = siren_chiffres {
        if !luhn_valide(s) {
            return Err(ApiError::bad_request(MSG_SIREN));
        }
    }
    let tva_brut = tva.map(str::trim).filter(|s| !s.is_empty());
    if let Some(tva) = tva_brut {
        let commence_fr = tva.trim_start().to_ascii_uppercase().starts_with("FR");
        if commence_fr {
            let Some((cle, siren_tva)) = tva_fr(tva) else {
                return Err(ApiError::bad_request(MSG_TVA));
            };
            if !luhn_valide(&siren_tva) {
                return Err(ApiError::bad_request(MSG_TVA));
            }
            let attendue = cle_tva(&siren_tva).ok_or_else(|| ApiError::bad_request(MSG_TVA))?;
            if cle != attendue {
                return Err(ApiError::bad_request(MSG_TVA));
            }
            if let Some(ref s) = siren_chiffres {
                if s != &siren_tva {
                    return Err(ApiError::bad_request(MSG_TVA));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::verifier_siren_tva;

    #[test]
    fn siren_fictif_et_cle_fr() {
        assert!(verifier_siren_tva(Some("100000009"), Some("FR88100000009")).is_ok());
        assert!(verifier_siren_tva(Some("100 000 009"), None).is_ok());
        assert!(verifier_siren_tva(Some("123456789"), None).is_err());
        assert!(verifier_siren_tva(Some("100000009"), Some("FR00100000009")).is_err());
        assert!(verifier_siren_tva(None, None).is_ok());
    }
}
