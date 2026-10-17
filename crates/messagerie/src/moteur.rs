//! Diff de relève. Le repli compare les UID et les drapeaux connus.
//! QRESYNC fournit déjà les retraits (`VANISHED`) et les états changés.

use crate::imap::EtatUid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Changement {
    Ajoute(EtatUid),
    Drapeaux(EtatUid),
    Retire { uid: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RapportMoteur {
    pub changements: Vec<Changement>,
}

/// Comparaison UID + drapeaux. Un UID disparu est un retrait, pas un oubli.
pub fn diff_repli(connus: &[EtatUid], vus: &[EtatUid]) -> RapportMoteur {
    let mut changements = Vec::new();
    let mut indice_connu = 0usize;
    let mut indice_vu = 0usize;
    while indice_connu < connus.len() || indice_vu < vus.len() {
        let connu = connus.get(indice_connu);
        let vu = vus.get(indice_vu);
        match (connu, vu) {
            (Some(ancien), Some(nouveau)) if ancien.uid == nouveau.uid => {
                if ancien.lu != nouveau.lu || ancien.drapeaux != nouveau.drapeaux {
                    changements.push(Changement::Drapeaux(nouveau.clone()));
                }
                indice_connu += 1;
                indice_vu += 1;
            }
            (Some(ancien), Some(nouveau)) if ancien.uid < nouveau.uid => {
                changements.push(Changement::Retire { uid: ancien.uid });
                indice_connu += 1;
            }
            (Some(_), None) => {
                changements.push(Changement::Retire {
                    uid: connus[indice_connu].uid,
                });
                indice_connu += 1;
            }
            (_, Some(nouveau)) => {
                changements.push(Changement::Ajoute(nouveau.clone()));
                indice_vu += 1;
            }
            (None, None) => break,
        }
    }
    RapportMoteur { changements }
}

/// Un message marqué `\Deleted` est un message supprimé pour tous les clients (ils le masquent
/// avant l'EXPUNGE) : la relève le traite comme retiré, sans quoi il reviendrait dans la liste.
/// Les drapeaux sont ceux de la relève (`Seen Deleted`, séparés par une espace).
pub fn ecarter_supprimes(changements: Vec<Changement>) -> Vec<Changement> {
    let supprime = |etat: &EtatUid| etat.drapeaux.split(' ').any(|drapeau| drapeau == "Deleted");
    changements
        .into_iter()
        .filter_map(|changement| match changement {
            Changement::Ajoute(etat) if supprime(&etat) => None,
            Changement::Drapeaux(etat) if supprime(&etat) => {
                Some(Changement::Retire { uid: etat.uid })
            }
            autre => Some(autre),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{diff_repli, ecarter_supprimes, Changement};
    use crate::imap::EtatUid;

    fn etat(uid: u32, lu: bool) -> EtatUid {
        EtatUid {
            uid,
            lu,
            drapeaux: if lu { "Seen".into() } else { String::new() },
        }
    }

    #[test]
    fn repli_voit_un_drapeau_et_un_retrait() {
        let connus = vec![etat(1, false), etat(2, false)];
        let vus = vec![etat(1, true)];
        let rapport = diff_repli(&connus, &vus);
        assert!(rapport
            .changements
            .iter()
            .any(|c| matches!(c, Changement::Drapeaux(e) if e.uid == 1 && e.lu)));
        assert!(rapport
            .changements
            .iter()
            .any(|c| matches!(c, Changement::Retire { uid: 2 })));
        assert!(!rapport
            .changements
            .iter()
            .any(|c| matches!(c, Changement::Ajoute(_))));
    }

    #[test]
    fn repli_ignore_un_uid_inchange() {
        let connus = vec![etat(4, true)];
        let rapport = diff_repli(&connus, &connus);
        assert!(rapport.changements.is_empty());
    }

    fn etat_avec(uid: u32, drapeaux: &str) -> EtatUid {
        EtatUid {
            uid,
            lu: drapeaux.contains("Seen"),
            drapeaux: drapeaux.into(),
        }
    }

    #[test]
    fn un_message_marque_supprime_est_retire_de_la_releve() {
        let changements = vec![
            Changement::Ajoute(etat_avec(1, "Deleted Seen")),
            Changement::Ajoute(etat_avec(2, "Seen")),
            Changement::Drapeaux(etat_avec(3, "Deleted")),
            Changement::Drapeaux(etat_avec(4, "Flagged Seen")),
            Changement::Retire { uid: 5 },
        ];
        let sortie = ecarter_supprimes(changements);
        assert_eq!(
            sortie,
            vec![
                Changement::Ajoute(etat_avec(2, "Seen")),
                Changement::Retire { uid: 3 },
                Changement::Drapeaux(etat_avec(4, "Flagged Seen")),
                Changement::Retire { uid: 5 },
            ]
        );
    }

    #[test]
    fn un_drapeau_dont_le_nom_contient_deleted_nest_pas_une_suppression() {
        // Mot-clé libre (`NotDeleted`) : seul le drapeau système compte.
        let sortie = ecarter_supprimes(vec![Changement::Drapeaux(etat_avec(7, "NotDeleted"))]);
        assert_eq!(
            sortie,
            vec![Changement::Drapeaux(etat_avec(7, "NotDeleted"))]
        );
    }
}
