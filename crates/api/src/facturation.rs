//! TVA en centimes. Taux en points de base : 2000 = 20,00 %.
//! Arrondi moitié vers le haut, à valider (docs/hypotheses-facturation.md).

pub fn tva_centimes(base_ht_centimes: i64, taux_bp: i32) -> i64 {
    let produit = base_ht_centimes * i64::from(taux_bp);
    (produit + 5_000) / 10_000
}

#[cfg(test)]
mod tests {
    use super::tva_centimes;

    #[test]
    fn vingt_pourcent_juste() {
        assert_eq!(tva_centimes(10_000, 2_000), 2_000);
    }

    #[test]
    fn arrondi_vers_le_bas_sous_la_moitie() {
        assert_eq!(tva_centimes(1_001, 2_000), 200);
    }

    #[test]
    fn arrondi_moitie_vers_le_haut() {
        assert_eq!(tva_centimes(1_003, 2_000), 201);
    }
}
