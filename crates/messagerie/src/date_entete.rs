//! Date d'en-tête (`Date:`) d'un message reçu.
//!
//! La date d'en-tête est celle que l'expéditeur a écrite : elle sert à l'affichage et au tri du
//! chrono d'un dossier. La date d'arrivée (`messages.cree_le`) reste distincte. Une date absente,
//! illisible ou hors des bornes ci-dessous n'est pas inventée : elle vaut « inconnue » (`None`) et
//! le poste retombe sur la date d'arrivée.
//!
//! Le fuseau écrit dans l'en-tête (`+0900`, `-0500`, `GMT`) est converti en instant UTC par
//! `mail-parser` ; l'instant est un nombre de secondes depuis l'époque Unix. Le décalage est
//! toujours explicite dans l'en-tête (RFC 5322 § 3.3) : le passage à l'heure d'hiver ne crée donc
//! aucune ambiguïté, contrairement à une heure locale sans fuseau.

use mail_parser::Message;

/// Borne basse : 1er janvier 1990 UTC. Avant, la date n'est pas celle d'un courrier réel (époque
/// Unix « 0 » d'un expéditeur qui ne sait pas dater, année « 00 » de logiciels anciens).
pub const BORNE_BASSE_SECS: i64 = 631_152_000;

/// Tolérance sur le futur : un jour après l'instant de la relève. Elle absorbe le décalage
/// d'horloge d'un expéditeur et son fuseau ; au-delà, la date est jugée fausse (un message ne
/// peut pas être daté du lendemain de son arrivée), jamais acceptée telle quelle.
pub const TOLERANCE_FUTUR_SECS: i64 = 86_400;

/// Date d'en-tête lue dans le message : secondes UTC depuis l'époque Unix, sans borne. `None` si
/// l'en-tête est absent ou illisible.
pub(crate) fn instant_entete(message: &Message<'_>) -> Option<i64> {
    let date = message.date()?;
    date.is_valid().then(|| date.to_timestamp())
}

/// Applique les bornes à une date d'en-tête lue. `maintenant` est l'instant de la relève (horloge
/// de l'appelant, injectable en test).
#[must_use]
pub fn borner_date_entete(instant: Option<i64>, maintenant: i64) -> Option<i64> {
    instant.filter(|valeur| {
        *valeur >= BORNE_BASSE_SECS && *valeur <= maintenant.saturating_add(TOLERANCE_FUTUR_SECS)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mail_parser::MessageParser;

    /// 14 octobre 2026, 12:00:00 UTC (horloge figée des tests).
    const MAINTENANT: i64 = 1_791_979_200;

    fn date_de(en_tetes: &str) -> Option<i64> {
        let brut = format!("From: a@example.com\r\n{en_tetes}Subject: s\r\n\r\ncorps\r\n");
        let message = MessageParser::default().parse(brut.as_bytes())?;
        borner_date_entete(instant_entete(&message), MAINTENANT)
    }

    #[test]
    fn une_date_ancienne_reste_differente_de_l_arrivee() {
        // Courrier daté de 2019, relevé en 2026 : la date d'en-tête n'est pas celle d'arrivée.
        let date = date_de("Date: Tue, 05 Mar 2019 10:30:00 +0000\r\n");
        assert_eq!(date, Some(1_551_781_800));
        assert_ne!(date, Some(MAINTENANT));
    }

    #[test]
    fn un_en_tete_absent_donne_inconnue() {
        assert_eq!(date_de(""), None);
    }

    #[test]
    fn un_en_tete_invalide_donne_inconnue() {
        for invalide in [
            "Date: pas une date\r\n",
            "Date: Tue, 32 Mar 2019 10:30:00 +0000\r\n",
            "Date: Tue, 05 Mar 2019 25:61:00 +0000\r\n",
            "Date:\r\n",
        ] {
            assert_eq!(date_de(invalide), None, "{invalide:?}");
        }
    }

    #[test]
    fn le_fuseau_etranger_est_converti_en_utc() {
        // 09:00 à Tokyo (+0900) = 00:00 UTC ; 20:00 à New York (-0500) = 01:00 UTC le lendemain.
        let tokyo = date_de("Date: Tue, 06 Oct 2026 09:00:00 +0900\r\n");
        let utc = date_de("Date: Tue, 06 Oct 2026 00:00:00 +0000\r\n");
        assert_eq!(tokyo, utc);
        let new_york = date_de("Date: Mon, 05 Oct 2026 20:00:00 -0500\r\n");
        let lendemain = date_de("Date: Tue, 06 Oct 2026 01:00:00 +0000\r\n");
        assert_eq!(new_york, lendemain);
        // Essai négatif : l'heure locale lue comme de l'UTC donnerait 9 h d'écart.
        assert_ne!(tokyo.map(|t| t - 9 * 3600), utc);
        // Nom de fuseau historique.
        assert_eq!(
            date_de("Date: Tue, 06 Oct 2026 07:00:00 GMT\r\n"),
            date_de("Date: Tue, 06 Oct 2026 09:00:00 +0200\r\n")
        );
    }

    #[test]
    fn le_passage_a_l_heure_d_hiver_garde_les_deux_02h30_distincts() {
        // Dimanche 26 octobre 2025 : en France, 03:00 (+0200) redevient 02:00 (+0100). Les deux
        // « 02:30 » existent ; le décalage écrit dans l'en-tête les distingue.
        let ete = date_de("Date: Sun, 26 Oct 2025 02:30:00 +0200\r\n");
        let hiver = date_de("Date: Sun, 26 Oct 2025 02:30:00 +0100\r\n");
        assert_eq!(ete, Some(1_761_438_600)); // 2025-10-26T00:30:00Z
        assert_eq!(hiver, Some(1_761_442_200)); // 2025-10-26T01:30:00Z
        assert_eq!(hiver.zip(ete).map(|(h, e)| h - e), Some(3600));
    }

    #[test]
    fn les_bornes_ecartent_le_futur_et_l_epoque_zero() {
        // Époque Unix « 0 » : avant la borne basse.
        assert_eq!(date_de("Date: Thu, 01 Jan 1970 00:00:00 +0000\r\n"), None);
        // Année 2099 : bien au-delà de la tolérance.
        assert_eq!(date_de("Date: Thu, 01 Jan 2099 00:00:00 +0000\r\n"), None);
        // Dans la tolérance : 23 h après l'instant de relève.
        assert_eq!(
            borner_date_entete(Some(MAINTENANT + 23 * 3600), MAINTENANT),
            Some(MAINTENANT + 23 * 3600)
        );
        // Pile sur les bornes : acceptées ; une seconde au-delà : écartées.
        assert_eq!(
            borner_date_entete(Some(MAINTENANT + TOLERANCE_FUTUR_SECS), MAINTENANT),
            Some(MAINTENANT + TOLERANCE_FUTUR_SECS)
        );
        assert_eq!(
            borner_date_entete(Some(MAINTENANT + TOLERANCE_FUTUR_SECS + 1), MAINTENANT),
            None
        );
        assert_eq!(
            borner_date_entete(Some(BORNE_BASSE_SECS), MAINTENANT),
            Some(BORNE_BASSE_SECS)
        );
        assert_eq!(
            borner_date_entete(Some(BORNE_BASSE_SECS - 1), MAINTENANT),
            None
        );
        assert_eq!(borner_date_entete(None, MAINTENANT), None);
    }
}
