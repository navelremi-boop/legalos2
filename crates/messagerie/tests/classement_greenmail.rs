//! Classement contre GreenMail 2.1.0 (`instance/imap-test`, 127.0.0.1:3143).
//! Mot de passe de test, déjà dans le compose.

#![allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use legalos_messagerie::{
    decider, integrer_releve, DecisionClassement, DossierPourClassement, EntreeClassement,
    FournisseurMail, MessageReleve, ParametresCompte, ReleveConnue, SessionActions,
};

fn parametres() -> (ParametresCompte, u16) {
    // Compose instance : 13143/13025 (login `demo`). Compose imap-test : 3143/3025 (capa).
    let (utilisateur, mot_de_passe, imap, smtp) = if std::env::var("LEGALOS_IMAP_INSTANCE").is_ok()
    {
        (
            "demo".into(),
            std::env::var("GREENMAIL_PASSWORD")
                .unwrap_or_else(|_| "remplacer-mot-de-passe-mail-test".into()),
            13143,
            13025,
        )
    } else {
        (
            "capa".into(),
            "MotDePasseCapa123!".into(),
            3143,
            3025,
        )
    };
    (
        ParametresCompte {
            hote: "127.0.0.1".into(),
            port: imap,
            utilisateur,
            mot_de_passe,
            tls: false,
        },
        smtp,
    )
}

fn dossiers() -> Vec<DossierPourClassement> {
    vec![
        DossierPourClassement {
            id: "ancien".into(),
            reference: "2026-001".into(),
            actif: true,
            correspondants: vec![],
        },
        DossierPourClassement {
            id: "nouveau".into(),
            reference: "RN/26/0002".into(),
            actif: true,
            correspondants: vec![],
        },
        DossierPourClassement {
            id: "seul".into(),
            reference: "2026-010".into(),
            actif: true,
            correspondants: vec!["client@example.com".into()],
        },
        DossierPourClassement {
            id: "autre".into(),
            reference: "2026-011".into(),
            actif: true,
            correspondants: vec!["client@example.com".into()],
        },
    ]
}

fn destinataire_boite(compte: &ParametresCompte) -> String {
    if compte.utilisateur.contains('@') {
        compte.utilisateur.clone()
    } else if compte.utilisateur == "demo" {
        "demo@cabinet.example".to_owned()
    } else {
        compte.utilisateur.clone()
    }
}

fn envoyer(
    smtp: u16,
    compte: &ParametresCompte,
    de: &str,
    vers: &str,
    objet: &str,
    identifiant: &str,
) {
    let mut flux = TcpStream::connect((compte.hote.as_str(), smtp)).expect("smtp");
    flux.set_read_timeout(Some(Duration::from_secs(5)))
        .expect("timeout");
    let mut lire = [0_u8; 512];
    let _ = flux.read(&mut lire);
    let corps = format!(
        "From: {de}\r\nTo: {vers}\r\nSubject: {objet}\r\nMessage-ID: <{identifiant}>\r\n\r\ncorps fictif\r\n"
    );
    let rcpt = destinataire_boite(compte);
    let commande = format!(
        "EHLO legalos\r\nMAIL FROM:<{de}>\r\nRCPT TO:<{rcpt}>\r\nDATA\r\n{corps}.\r\nQUIT\r\n"
    );
    flux.write_all(commande.as_bytes()).expect("ecriture smtp");
    let _ = flux.read(&mut lire);
}

#[test]
fn classement_greenmail_adresse_objet_correspondant_et_reprise() {
    let (compte, smtp) = parametres();
    let boite = destinataire_boite(&compte);
    envoyer(
        smtp,
        &compte,
        "x@example.com",
        "classement+2026-001@cabinet.example",
        "bonjour",
        "m-adresse@legalos.test",
    );
    envoyer(
        smtp,
        &compte,
        "x@example.com",
        &boite,
        "Dossier RN-26-0002",
        "m-objet@legalos.test",
    );
    envoyer(
        smtp,
        &compte,
        "client@example.com",
        &boite,
        "sans reference",
        "m-corresp@legalos.test",
    );
    envoyer(
        smtp,
        &compte,
        "inconnu@example.com",
        &boite,
        "bonjour",
        "m-rien@legalos.test",
    );

    let mut imap = SessionActions::connecter(&compte).expect("imap");
    let (validite, entetes) = imap
        .relever_entetes("INBOX", None, Some(2))
        .expect("releve partielle");
    assert_eq!(entetes.len(), 2, "interruption apres deux messages");
    let mut connue = ReleveConnue {
        uid_validity: validite,
        dernier_uid: entetes.iter().map(|m| m.uid).max().unwrap_or(0),
        identifiants: entetes.iter().map(|m| m.message_id.clone()).collect(),
    };
    let (_validite2, suite) = imap.relever_entetes("INBOX", None, None).expect("reprise");
    let messages: Vec<MessageReleve> = suite
        .iter()
        .map(|m| MessageReleve {
            uid: m.uid,
            identifiant: m.message_id.clone(),
        })
        .collect();
    let neufs = integrer_releve(&mut connue, validite, &messages);
    assert!(
        neufs
            .iter()
            .all(|m| entetes.iter().all(|e| e.message_id != m.identifiant)),
        "un identifiant deja releve ne revient pas"
    );
    assert!(
        suite.iter().any(|m| m.message_id.contains("m-rien")),
        "la reprise n'a pas perdu le dernier message"
    );

    let dossiers = dossiers();
    let mut vus = std::collections::BTreeSet::new();
    for entete in entetes.iter().chain(suite.iter()) {
        if !vus.insert(entete.message_id.clone()) {
            continue;
        }
        let decision = decider(
            &EntreeClassement {
                destinataires: entete.destinataires.clone(),
                objet: entete.objet.clone(),
                expediteur: entete.expediteur.clone(),
            },
            &dossiers,
        );
        if entete.message_id.contains("m-adresse") {
            assert_eq!(
                decision,
                DecisionClassement::Classe {
                    dossier_id: "ancien".into()
                }
            );
        }
        if entete.message_id.contains("m-objet") {
            assert_eq!(
                decision,
                DecisionClassement::Classe {
                    dossier_id: "nouveau".into()
                }
            );
        }
        if entete.message_id.contains("m-corresp") {
            assert_eq!(
                decision,
                DecisionClassement::Suggestion {
                    dossier_id: "seul".into()
                }
            );
        }
        if entete.message_id.contains("m-rien") {
            assert_eq!(decision, DecisionClassement::AClasser);
        }
    }
    assert!(
        entetes
            .iter()
            .chain(suite.iter())
            .any(|m| m.message_id.contains("m-adresse")),
        "adresse de classement absente de la relève"
    );
    assert!(
        entetes
            .iter()
            .chain(suite.iter())
            .any(|m| m.message_id.contains("m-objet")),
        "référence d'objet absente de la relève"
    );
}
