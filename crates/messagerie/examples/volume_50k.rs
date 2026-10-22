//! Mesure 50 000 messages : repli par comparaison, puis QRESYNC.
//! Lancé par `tests/recette/s7-synchro.mjs` (`cargo run -p legalos-messagerie --example volume_50k`).
//! Ce n'est pas un test de `cargo test` : il exige la boîte Dovecot de 50 000 messages d'imap-test.

use std::process::ExitCode;
use std::time::Instant;

use legalos_messagerie::{ParametresCompte, SessionActions};

fn mesurer() -> Result<(usize, u128, u128), String> {
    let compte = ParametresCompte {
        hote: "127.0.0.1".into(),
        port: 1143,
        utilisateur: "capa".into(),
        mot_de_passe: "MotDePasseCapa123!".into(),
        tls: false,
        jeton_acces: None,
    };
    let mut repli = SessionActions::connecter(&compte).map_err(|e| format!("dovecot : {e:?}"))?;
    let debut = Instant::now();
    let n_repli = repli
        .compter_entetes(false)
        .map_err(|e| format!("repli : {e:?}"))?;
    let repli_ms = debut.elapsed().as_millis();
    let mut rapide =
        SessionActions::connecter(&compte).map_err(|e| format!("dovecot qresync : {e:?}"))?;
    let debut = Instant::now();
    let n_qresync = rapide
        .compter_entetes(true)
        .map_err(|e| format!("qresync : {e:?}"))?;
    let qresync_ms = debut.elapsed().as_millis();
    if n_repli < 50_000 {
        return Err(format!("repli {n_repli} messages, 50 000 attendus"));
    }
    if n_qresync < 50_000 {
        return Err(format!("qresync {n_qresync} messages, 50 000 attendus"));
    }
    Ok((n_repli, repli_ms, qresync_ms))
}

fn main() -> ExitCode {
    match mesurer() {
        Ok((messages, repli_ms, qresync_ms)) => {
            println!("volume messages={messages} repli_ms={repli_ms} qresync_ms={qresync_ms}");
            ExitCode::SUCCESS
        }
        Err(raison) => {
            eprintln!("volume_50k : {raison}");
            ExitCode::FAILURE
        }
    }
}
