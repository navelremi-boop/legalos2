/// Capacités annoncées, réduites à ce que le moteur utilise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capacites {
    pub idle: bool,
    pub qresync: bool,
    pub condstore: bool,
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

/// Curseur d'une relève d'en-têtes : le dernier UID intégré **dans la génération (UIDVALIDITY)** où
/// il a été lu. Un UID n'a de sens qu'avec sa UIDVALIDITY (RFC 3501 § 2.3.1.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurseurReleve {
    pub uid_validity: u32,
    pub dernier_uid: u32,
}

/// UID après lequel reprendre, compte tenu de la UIDVALIDITY annoncée par le serveur : le curseur
/// n'est suivi que si la génération est la même. Sinon (serveur réinitialisé, boîte recréée), les
/// UID connus ne désignent plus les mêmes messages : la relève repart du début. Sans cela, un
/// curseur d'avant la réinitialisation écarte tous les messages d'UID inférieur.
pub fn uid_de_reprise(connu: Option<CurseurReleve>, annonce: u32) -> Option<u32> {
    match connu {
        Some(curseur) if curseur.uid_validity == annonce && curseur.dernier_uid > 0 => {
            Some(curseur.dernier_uid)
        }
        _ => None,
    }
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
        chemin_veille, suite_uid_validity, uid_de_reprise, Capacites, CheminVeille, CurseurDossier,
        CurseurReleve, SuiteDossier,
    };

    fn caps(qresync: bool) -> Capacites {
        Capacites {
            idle: true,
            qresync,
            condstore: qresync,
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

    #[test]
    fn la_reprise_ne_suit_le_curseur_que_dans_la_meme_generation() {
        let curseur = CurseurReleve {
            uid_validity: 5,
            dernier_uid: 700,
        };
        assert_eq!(uid_de_reprise(Some(curseur), 5), Some(700));
        // Serveur réinitialisé : UIDVALIDITY différente, les UID repartent de 1.
        assert_eq!(uid_de_reprise(Some(curseur), 6), None);
        assert_eq!(uid_de_reprise(None, 5), None);
        let vide = CurseurReleve {
            uid_validity: 5,
            dernier_uid: 0,
        };
        assert_eq!(uid_de_reprise(Some(vide), 5), None);
    }
}
