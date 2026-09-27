/// Capacités annoncées, réduites à ce que le moteur utilise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capacites {
    pub idle: bool,
    pub qresync: bool,
    /// Jetons tels qu'annoncés, pour le constat de test. Pas des types du codec.
    pub jetons: Vec<String>,
}

/// Chemin de la veille sur la boîte de réception.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheminVeille {
    /// IDLE, puis deltas QRESYNC.
    Qresync,
    /// Le serveur n'annonce pas QRESYNC : comparaison du dossier à chaque réveil.
    Repli,
}

/// Dernier état connu d'un dossier, côté moteur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurseurDossier {
    pub uid_validity: u32,
}

/// Suite d'une relève. Un changement d'UIDVALIDITY impose une resynchronisation
/// complète : les UID précédents ne désignent plus les mêmes messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuiteDossier {
    Incrementale { uid_validity: u32 },
    ResynchronisationComplete { uid_validity: u32 },
}

pub fn chemin_veille(capacites: &Capacites) -> CheminVeille {
    if capacites.qresync {
        CheminVeille::Qresync
    } else {
        CheminVeille::Repli
    }
}

pub fn suite_uid_validity(connu: Option<CurseurDossier>, annonce: u32) -> SuiteDossier {
    match connu {
        Some(curseur) if curseur.uid_validity == annonce => SuiteDossier::Incrementale {
            uid_validity: annonce,
        },
        _ => SuiteDossier::ResynchronisationComplete {
            uid_validity: annonce,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        chemin_veille, suite_uid_validity, Capacites, CheminVeille, CurseurDossier, SuiteDossier,
    };

    fn caps(qresync: bool) -> Capacites {
        Capacites {
            idle: true,
            qresync,
            jetons: Vec::new(),
        }
    }

    #[test]
    fn qresync_choisit_ce_chemin() {
        assert_eq!(chemin_veille(&caps(true)), CheminVeille::Qresync);
        assert_eq!(chemin_veille(&caps(false)), CheminVeille::Repli);
    }

    #[test]
    fn uid_validity_inconnu_ou_change_resynchronise() {
        assert_eq!(
            suite_uid_validity(None, 7),
            SuiteDossier::ResynchronisationComplete { uid_validity: 7 }
        );
        assert_eq!(
            suite_uid_validity(Some(CurseurDossier { uid_validity: 3 }), 9),
            SuiteDossier::ResynchronisationComplete { uid_validity: 9 }
        );
        assert_eq!(
            suite_uid_validity(Some(CurseurDossier { uid_validity: 3 }), 3),
            SuiteDossier::Incrementale { uid_validity: 3 }
        );
    }
}
