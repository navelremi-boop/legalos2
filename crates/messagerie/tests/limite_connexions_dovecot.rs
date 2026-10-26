//! Limite de connexions d'un même utilisateur chez Dovecot (J11, consigne de l'architecte du 26/10/2026) : la connexion
//! refusée pour cause de limite est une `Connexion` (panne passagère, retentée), jamais une `Authentification` (elle
//! marquait une boîte au bon mot de passe « Identifiants refusés » et suspendait ses tentatives). Un vrai mot de passe
//! faux reste une `Authentification`.
//!
//! Conteneur dédié (`dovecot-limite.conf`, deux connexions par utilisateur), démarré à la demande ; l'absence de Docker
//! est un échec, le test n'est pas ignoré.

#![allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]

use std::net::TcpStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use legalos_messagerie::{ErreurMail, ParametresCompte, SessionActions};

const PORT: u16 = 24_147;
const NOM: &str = "legalos-j11-dovecot-limite";

fn parametres(mot_de_passe: &str) -> ParametresCompte {
    ParametresCompte {
        hote: "127.0.0.1".to_owned(),
        port: PORT,
        utilisateur: "capa".to_owned(),
        mot_de_passe: mot_de_passe.to_owned(),
        tls: false,
        jeton_acces: None,
    }
}

fn assurer_dovecot() {
    if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
        return;
    }
    let racine = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("racine du dépôt");
    let configuration = racine.join("instance/imap-test/dovecot-limite.conf");
    let _ = Command::new("docker")
        .args(["rm", "-f", NOM])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let lancement = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name",
            NOM,
            "-p",
            &format!("127.0.0.1:{PORT}:143"),
            "-v",
            &format!("{}:/etc/dovecot/dovecot.conf:ro", configuration.display()),
            "--entrypoint",
            "sh",
            "dovecot/dovecot:2.3.21.1",
            "-c",
            "mkdir -p /tmp/mail/capa && chown -R dovecot:dovecot /tmp/mail && exec dovecot -F",
        ])
        .output()
        .expect("docker indisponible pour Dovecot");
    assert!(
        lancement.status.success(),
        "Dovecot n'a pas démarré : {}",
        String::from_utf8_lossy(&lancement.stderr)
    );
    let joignable = (0..60).any(|_| {
        let ouvert = TcpStream::connect(("127.0.0.1", PORT)).is_ok();
        if !ouvert {
            thread::sleep(Duration::from_millis(500));
        }
        ouvert
    });
    assert!(joignable, "Dovecot {PORT} n'accepte pas de connexion");
}

fn connecter_avec_reprise(mot_de_passe: &str) -> Result<SessionActions, ErreurMail> {
    let mut derniere = None;
    for _ in 0..40 {
        match SessionActions::connecter(&parametres(mot_de_passe)) {
            Ok(session) => return Ok(session),
            // Le serveur peut ne pas être prêt : seule une connexion refusée sans réponse se retente ici.
            Err(ErreurMail::Connexion) if TcpStream::connect(("127.0.0.1", PORT)).is_err() => {
                thread::sleep(Duration::from_millis(500));
            }
            Err(erreur) => {
                derniere = Some(erreur);
                break;
            }
        }
    }
    Err(derniere.unwrap_or(ErreurMail::Connexion))
}

#[test]
fn la_limite_de_connexions_n_est_pas_un_refus_d_identifiants() {
    assurer_dovecot();
    let _premiere = connecter_avec_reprise("MotDePasseCapa123!").expect("première connexion");
    let _seconde = connecter_avec_reprise("MotDePasseCapa123!").expect("seconde connexion");
    // La troisième dépasse la limite de deux : panne passagère, avec les bons identifiants.
    match SessionActions::connecter(&parametres("MotDePasseCapa123!")) {
        Err(ErreurMail::Connexion) => {}
        Err(ErreurMail::Authentification) => {
            panic!("une limite de connexions a été prise pour un refus d'identifiants")
        }
        Err(autre) => panic!("erreur inattendue : {autre:?}"),
        Ok(_) => panic!("la limite de deux connexions n'a pas joué"),
    }
}

/// Essai négatif : avec une place libre, un mauvais mot de passe reste un refus d'identifiants, et la limite levée, la
/// connexion aux bons identifiants réussit de nouveau.
#[test]
fn un_mauvais_mot_de_passe_reste_un_refus_et_la_place_liberee_sert() {
    assurer_dovecot();
    // Les deux tests partagent le serveur : on attend qu'il n'y ait pas plus d'une connexion tenue par l'autre test.
    let mut refus = None;
    for _ in 0..40 {
        match SessionActions::connecter(&parametres("MauvaisMotDePasse")) {
            Err(ErreurMail::Authentification) => {
                refus = Some(true);
                break;
            }
            Err(ErreurMail::Connexion) => thread::sleep(Duration::from_millis(500)),
            Err(autre) => panic!("erreur inattendue : {autre:?}"),
            Ok(_) => panic!("un mauvais mot de passe a été accepté"),
        }
    }
    assert_eq!(
        refus,
        Some(true),
        "le mauvais mot de passe n'a jamais donné un refus d'identifiants"
    );
    let session = (0..40).find_map(|_| {
        SessionActions::connecter(&parametres("MotDePasseCapa123!"))
            .ok()
            .or_else(|| {
                thread::sleep(Duration::from_millis(500));
                None
            })
    });
    assert!(
        session.is_some(),
        "aucune place libérée pour de bons identifiants"
    );
}
