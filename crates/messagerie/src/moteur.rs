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

#[cfg(test)]
mod tests {
    use super::{diff_repli, Changement};
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
}
