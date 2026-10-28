//! Codes de secours : dix codes à usage unique, hachés, régénérables.
//! Le clair n'est renvoyé qu'au moment de la génération.

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::ApiError;

const NOMBRE: usize = 10;
const LONGUEUR: usize = 8;
/// Sans caractères ambigus (0/O, 1/I).
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// Dix codes affichés `XXXX-XXXX`, tous différents.
pub fn generer_codes() -> Vec<String> {
    use rand::RngCore;
    let mut rng = rand::rngs::OsRng;
    let mut codes = Vec::with_capacity(NOMBRE);
    while codes.len() < NOMBRE {
        let mut brut = String::with_capacity(LONGUEUR);
        for _ in 0..LONGUEUR {
            let indice = (rng.next_u32() as usize) % ALPHABET.len();
            brut.push(ALPHABET[indice] as char);
        }
        let affiche = format!("{}-{}", &brut[..4], &brut[4..]);
        if !codes.contains(&affiche) {
            codes.push(affiche);
        }
    }
    codes
}

/// Forme canonique, sans tiret ni espace. `None` si le code n'a pas la forme attendue.
pub fn normaliser(saisie: &str) -> Option<String> {
    let brut: String = saisie
        .chars()
        .filter(|caractere| !caractere.is_whitespace() && *caractere != '-')
        .flat_map(|caractere| caractere.to_uppercase())
        .collect();
    if brut.len() != LONGUEUR {
        return None;
    }
    if !brut.bytes().all(|octet| ALPHABET.contains(&octet)) {
        return None;
    }
    Some(brut)
}

fn empreinte(clef: &[u8; 32], canonique: &str) -> String {
    hex::encode(hmac_sha256(clef, canonique.as_bytes()))
}

fn hmac_sha256(clef: &[u8; 32], message: &[u8]) -> [u8; 32] {
    const BLOC: usize = 64;
    let mut k = [0u8; BLOC];
    k[..32].copy_from_slice(clef);
    let mut ipad = [0x36u8; BLOC];
    let mut opad = [0x5cu8; BLOC];
    for i in 0..BLOC {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let mut interne = Sha256::new();
    interne.update(ipad);
    interne.update(message);
    let interne = interne.finalize();
    let mut externe = Sha256::new();
    externe.update(opad);
    externe.update(interne);
    externe.finalize().into()
}

/// Remplace les codes de l'utilisateur. L'ancien stock, utilisé ou non, disparaît.
/// Les codes en clair ne sont que dans la valeur de retour.
pub async fn remplacer(
    pool: &PgPool,
    utilisateur_id: Uuid,
    clef: &[u8; 32],
) -> Result<Vec<String>, ApiError> {
    let codes = generer_codes();
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| ApiError::internal("Codes de secours"))?;
    sqlx::query("DELETE FROM codes_secours WHERE utilisateur_id = $1")
        .bind(utilisateur_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiError::internal("Codes de secours"))?;
    for code in &codes {
        let canonique = normaliser(code).ok_or_else(|| ApiError::internal("Codes de secours"))?;
        sqlx::query(
            "INSERT INTO codes_secours (id, utilisateur_id, empreinte) VALUES ($1, $2, $3)",
        )
        .bind(Uuid::now_v7())
        .bind(utilisateur_id)
        .bind(empreinte(clef, &canonique))
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiError::internal("Codes de secours"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|_| ApiError::internal("Codes de secours"))?;
    Ok(codes)
}

/// Consomme un code encore inutilisé. Faux si la forme est mauvaise, inconnue ou déjà utilisée.
pub async fn consommer(
    pool: &PgPool,
    utilisateur_id: Uuid,
    saisie: &str,
    clef: &[u8; 32],
) -> Result<bool, ApiError> {
    let Some(canonique) = normaliser(saisie) else {
        return Ok(false);
    };
    let ligne = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE codes_secours
        SET utilise_le = NOW()
        WHERE utilisateur_id = $1 AND empreinte = $2 AND utilise_le IS NULL
        RETURNING id
        "#,
    )
    .bind(utilisateur_id)
    .bind(empreinte(clef, &canonique))
    .fetch_optional(pool)
    .await
    .map_err(|_| ApiError::internal("Codes de secours"))?;
    Ok(ligne.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dix_codes_distincts_et_une_empreinte_sans_le_clair() {
        let codes = generer_codes();
        assert_eq!(codes.len(), 10);
        let mut vus = codes.clone();
        vus.sort();
        vus.dedup();
        assert_eq!(vus.len(), 10);
        let clef = [7u8; 32];
        for code in &codes {
            let canonique = normaliser(code).unwrap_or_default();
            assert_eq!(canonique.len(), 8);
            let stock = empreinte(&clef, &canonique);
            assert!(!stock.contains(&canonique));
            assert_ne!(stock, empreinte(&[8u8; 32], &canonique));
        }
    }

    #[test]
    fn la_saisie_ignore_les_tirets_et_la_casse() {
        assert_eq!(normaliser("abcd-efgh"), normaliser("ABCD EFGH"));
        assert_eq!(normaliser("pas-un-code"), None);
        assert_eq!(normaliser("ABCD-EFG0"), None);
    }
}
