//! Classement automatique d'un message entrant. Aucun contenu n'est journalisé.

use legalos_domaine::reference::{forme_classement, reference_citee};

/// Dossier candidat. `correspondants` sont des adresses, comparées sans casse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DossierPourClassement {
    pub id: String,
    pub reference: String,
    pub actif: bool,
    pub correspondants: Vec<String>,
}

/// Décision. Une suggestion n'est pas un rattachement : le message reste à classer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecisionClassement {
    Classe { dossier_id: String },
    Suggestion { dossier_id: String },
    AClasser,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntreeClassement {
    pub destinataires: Vec<String>,
    pub objet: String,
    pub expediteur: String,
}

/// Ce qui est déjà connu d'une relève, pour la reprendre sans doublon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleveConnue {
    pub uid_validity: u32,
    pub dernier_uid: u32,
    pub identifiants: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageReleve {
    pub uid: u32,
    pub identifiant: String,
}

/// Adresse `classement+forme@…`, référence citée dans l'objet (forme d'origine ou de
/// classement, donc tous les modèles déjà attribués), ou correspondant d'un seul dossier actif.
pub fn decider(
    entree: &EntreeClassement,
    dossiers: &[DossierPourClassement],
) -> DecisionClassement {
    if let Some(id) = par_adresse(&entree.destinataires, dossiers) {
        return DecisionClassement::Classe { dossier_id: id };
    }
    let cites: Vec<&DossierPourClassement> = dossiers
        .iter()
        .filter(|dossier| reference_citee(&dossier.reference, &entree.objet))
        .collect();
    if cites.len() == 1 {
        let dossier = cites[0];
        return DecisionClassement::Classe {
            dossier_id: dossier.id.clone(),
        };
    }
    let actifs: Vec<&DossierPourClassement> = dossiers
        .iter()
        .filter(|dossier| dossier.actif && correspondant(dossier, &entree.expediteur))
        .collect();
    if actifs.len() == 1 {
        let dossier = actifs[0];
        return DecisionClassement::Classe {
            dossier_id: dossier.id.clone(),
        };
    }
    if let Some(dossier) = actifs.first().copied().or_else(|| cites.first().copied()) {
        return DecisionClassement::Suggestion {
            dossier_id: dossier.id.clone(),
        };
    }
    DecisionClassement::AClasser
}

/// Reprend une relève. Un changement d'UIDVALIDITY reprend tous les UID, mais un
/// identifiant déjà intégré n'est jamais renvoyé.
pub fn integrer_releve(
    connue: &mut ReleveConnue,
    uid_validity: u32,
    messages: &[MessageReleve],
) -> Vec<MessageReleve> {
    if connue.uid_validity != uid_validity {
        connue.uid_validity = uid_validity;
        connue.dernier_uid = 0;
    }
    let mut neufs = Vec::new();
    let mut max_uid = connue.dernier_uid;
    for message in messages {
        if message.uid <= connue.dernier_uid && connue.uid_validity == uid_validity {
            continue;
        }
        if connue
            .identifiants
            .iter()
            .any(|id| id == &message.identifiant)
        {
            max_uid = max_uid.max(message.uid);
            continue;
        }
        connue.identifiants.push(message.identifiant.clone());
        neufs.push(message.clone());
        max_uid = max_uid.max(message.uid);
    }
    connue.dernier_uid = max_uid;
    neufs
}

fn par_adresse(destinataires: &[String], dossiers: &[DossierPourClassement]) -> Option<String> {
    let mut trouve: Option<String> = None;
    for destinataire in destinataires {
        let Some(local) = destinataire.split('@').next() else {
            continue;
        };
        let Some((prefixe, forme)) = local.split_once('+') else {
            continue;
        };
        if !prefixe.eq_ignore_ascii_case("classement") {
            continue;
        }
        let mut id = None;
        for dossier in dossiers {
            if forme_classement(&dossier.reference).eq_ignore_ascii_case(forme) {
                if id.is_some() {
                    return None;
                }
                id = Some(dossier.id.clone());
            }
        }
        if let Some(dossier_id) = id {
            if trouve
                .as_ref()
                .is_some_and(|existant| existant != &dossier_id)
            {
                return None;
            }
            trouve = Some(dossier_id);
        }
    }
    trouve
}

fn correspondant(dossier: &DossierPourClassement, expediteur: &str) -> bool {
    let cherche = expediteur.trim();
    dossier
        .correspondants
        .iter()
        .any(|adresse| adresse.eq_ignore_ascii_case(cherche))
}

#[cfg(test)]
mod tests {
    use super::{
        decider, integrer_releve, DecisionClassement, DossierPourClassement, EntreeClassement,
        MessageReleve, ReleveConnue,
    };

    fn dossier(
        id: &str,
        reference: &str,
        actif: bool,
        correspondants: &[&str],
    ) -> DossierPourClassement {
        DossierPourClassement {
            id: id.to_owned(),
            reference: reference.to_owned(),
            actif,
            correspondants: correspondants.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    fn entree(destinataires: &[&str], objet: &str, expediteur: &str) -> EntreeClassement {
        EntreeClassement {
            destinataires: destinataires.iter().map(|s| (*s).to_owned()).collect(),
            objet: objet.to_owned(),
            expediteur: expediteur.to_owned(),
        }
    }

    #[test]
    fn adresse_de_classement_rattache_la_forme_normalisee() {
        let dossiers = vec![dossier("a", "2026/042", true, &[])];
        let decision = decider(
            &entree(
                &["classement+2026-042@cabinet.example"],
                "bonjour",
                "x@cabinet.example",
            ),
            &dossiers,
        );
        assert_eq!(
            decision,
            DecisionClassement::Classe {
                dossier_id: "a".to_owned()
            }
        );
    }

    #[test]
    fn objet_cite_la_forme_d_origine_ou_normalisee() {
        let dossiers = vec![dossier("a", "2026/042", true, &[])];
        for objet in ["Pièces 2026/042 jointes", "Pièces 2026-042 jointes"] {
            assert_eq!(
                decider(
                    &entree(&["contact@cabinet.example"], objet, "x@cabinet.example"),
                    &dossiers
                ),
                DecisionClassement::Classe {
                    dossier_id: "a".to_owned()
                }
            );
        }
    }

    #[test]
    fn deux_modeles_successifs_sont_reconnus() {
        let dossiers = vec![
            dossier("ancien", "2026-001", true, &[]),
            dossier("nouveau", "RN/26/0002", true, &[]),
        ];
        assert_eq!(
            decider(
                &entree(&[], "Dossier 2026-001", "x@cabinet.example"),
                &dossiers
            ),
            DecisionClassement::Classe {
                dossier_id: "ancien".to_owned()
            }
        );
        assert_eq!(
            decider(
                &entree(&[], "Dossier RN-26-0002", "x@cabinet.example"),
                &dossiers
            ),
            DecisionClassement::Classe {
                dossier_id: "nouveau".to_owned()
            }
        );
    }

    #[test]
    fn correspondant_d_un_seul_dossier_actif() {
        let dossiers = vec![
            dossier("actif", "2026-010", true, &["client@example.com"]),
            dossier("clos", "2026-011", false, &["client@example.com"]),
        ];
        assert_eq!(
            decider(
                &entree(&[], "sans référence", "client@example.com"),
                &dossiers
            ),
            DecisionClassement::Classe {
                dossier_id: "actif".to_owned()
            }
        );
    }

    #[test]
    fn plusieurs_dossiers_actifs_donnent_une_suggestion() {
        let dossiers = vec![
            dossier("a", "2026-010", true, &["client@example.com"]),
            dossier("b", "2026-011", true, &["client@example.com"]),
        ];
        assert_eq!(
            decider(
                &entree(&[], "sans référence", "client@example.com"),
                &dossiers
            ),
            DecisionClassement::Suggestion {
                dossier_id: "a".to_owned()
            }
        );
    }

    #[test]
    fn sans_signal_reste_a_classer() {
        let dossiers = vec![dossier("a", "2026-010", true, &["autre@example.com"])];
        assert_eq!(
            decider(&entree(&[], "bonjour", "inconnu@example.com"), &dossiers),
            DecisionClassement::AClasser
        );
    }

    #[test]
    fn releve_interrompue_ne_perd_rien_et_ne_double_pas() {
        let mut connue = ReleveConnue {
            uid_validity: 1,
            dernier_uid: 1,
            identifiants: vec!["m1".to_owned()],
        };
        let lot = vec![
            MessageReleve {
                uid: 1,
                identifiant: "m1".to_owned(),
            },
            MessageReleve {
                uid: 2,
                identifiant: "m2".to_owned(),
            },
            MessageReleve {
                uid: 3,
                identifiant: "m3".to_owned(),
            },
        ];
        let premiers = integrer_releve(&mut connue, 1, &lot[..2]);
        assert_eq!(premiers.len(), 1);
        assert_eq!(premiers[0].identifiant, "m2");
        let reprise = integrer_releve(&mut connue, 1, &lot);
        assert_eq!(reprise.len(), 1);
        assert_eq!(reprise[0].identifiant, "m3");
        assert!(integrer_releve(&mut connue, 1, &lot).is_empty());
    }
}
