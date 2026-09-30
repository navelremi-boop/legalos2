#![allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]
//! Chemins QRESYNC et repli, réellement distincts.
//! GreenMail 2.1.0 : 127.0.0.1:3143. Dovecot : 127.0.0.1:1143.
//! `LEGALOS_IMAP_CI=1` : l'absence du serveur est un échec (job rust).

use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use legalos_messagerie::{ParametresCompte, SessionActions};

fn joignable(adresse: SocketAddr) -> bool {
    TcpStream::connect_timeout(&adresse, Duration::from_millis(400)).is_ok()
}

fn exiger_ou_passer(adresse: SocketAddr) {
    if joignable(adresse) {
        return;
    }
    if std::env::var("LEGALOS_IMAP_CI").is_ok() {
        panic!("serveur IMAP absent en CI : {adresse}");
    }
}

fn compte(port: u16) -> ParametresCompte {
    ParametresCompte {
        hote: "127.0.0.1".into(),
        port,
        utilisateur: "capa".into(),
        mot_de_passe: "MotDePasseCapa123!".into(),
        tls: false,
    }
}

#[test]
fn greenmail_repli_sans_changedsince() {
    let adresse = "127.0.0.1:3143".parse().unwrap();
    exiger_ou_passer(adresse);
    if !joignable(adresse) {
        return;
    }
    let mut session = SessionActions::connecter(&compte(3143)).expect("greenmail");
    let releve = session.synchroniser_dossier("INBOX", 0).expect("relève");
    assert!(
        !releve.qresync,
        "GreenMail ne doit pas prendre le chemin QRESYNC"
    );
    assert!(
        releve
            .commandes
            .iter()
            .all(|c| !c.contains("CHANGEDSINCE") && !c.contains("QRESYNC")),
        "repli : {:?}",
        releve.commandes
    );
}

#[test]
fn dovecot_qresync_changedsince_du_modseq_connu() {
    let adresse = "127.0.0.1:1143".parse().unwrap();
    exiger_ou_passer(adresse);
    if !joignable(adresse) {
        return;
    }
    let mut session = SessionActions::connecter(&compte(1143)).expect("dovecot");
    let premiere = session.synchroniser_dossier("INBOX", 0).expect("première");
    assert!(premiere.qresync, "Dovecot annonce QRESYNC");
    if premiere.modseq == 0 {
        return;
    }
    let seconde = session
        .synchroniser_dossier("INBOX", premiere.modseq)
        .expect("delta");
    let attendu = format!("FETCH CHANGEDSINCE {}", premiere.modseq);
    assert!(
        seconde.commandes.iter().any(|c| c == &attendu),
        "CHANGEDSINCE sur le MODSEQ connu, obtenu {:?}",
        seconde.commandes
    );
    assert!(
        seconde
            .commandes
            .iter()
            .any(|c| c.starts_with("SELECT QRESYNC")),
        "SELECT QRESYNC absent : {:?}",
        seconde.commandes
    );
}
