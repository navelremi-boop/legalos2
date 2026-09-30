//! Mesure 50 000 messages : repli par comparaison, puis QRESYNC.
//! Lancé par `tests/recette/s7-synchro.mjs` (`--ignored`).

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::Instant;

use legalos_messagerie::{ParametresCompte, SessionActions};

#[test]
#[ignore = "boîte Dovecot de 50 000 messages, appelée par s7-synchro.mjs"]
fn volume_50k_qresync_et_repli() {
    let compte = ParametresCompte {
        hote: "127.0.0.1".into(),
        port: 1143,
        utilisateur: "capa".into(),
        mot_de_passe: "MotDePasseCapa123!".into(),
        tls: false,
    };
    let mut repli = SessionActions::connecter(&compte).expect("dovecot");
    let debut = Instant::now();
    let n_repli = repli.compter_entetes(false).expect("repli");
    let repli_ms = debut.elapsed().as_millis();
    let mut rapide = SessionActions::connecter(&compte).expect("dovecot qresync");
    let debut = Instant::now();
    let n_qresync = rapide.compter_entetes(true).expect("qresync");
    let qresync_ms = debut.elapsed().as_millis();
    assert!(
        n_repli >= 50_000,
        "repli {n_repli} messages, 50 000 attendus"
    );
    assert!(
        n_qresync >= 50_000,
        "qresync {n_qresync} messages, 50 000 attendus"
    );
    println!("volume messages={n_repli} repli_ms={repli_ms} qresync_ms={qresync_ms}");
}
