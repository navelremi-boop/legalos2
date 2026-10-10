//! Brouillon déposé dans le dossier Brouillons de GreenMail 2.1.0.
//!
//! Conteneur dédié, port hôte 23143. L'absence du serveur est un échec :
//! le test n'est pas ignoré.
//!
//! ```text
//! docker run -d --name legalos-j11-brouillon -p 127.0.0.1:23143:3143 ^
//!   -e GREENMAIL_OPTS=-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=redacteur:MotDePasseRedaction123! ^
//!   greenmail/standalone:2.1.0
//! ```

#![allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]

use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use legalos_messagerie::{
    construire_message, DemandeRedaction, FournisseurMail, GenreRedaction, MessageOrigine,
    ParametresCompte, PieceJointe, SessionActions, DOSSIER_BROUILLONS,
};

fn parametres() -> ParametresCompte {
    ParametresCompte {
        hote: "127.0.0.1".to_owned(),
        port: 23_143,
        utilisateur: "redacteur".to_owned(),
        mot_de_passe: "MotDePasseRedaction123!".to_owned(),
        tls: false,
    }
}

fn origine() -> MessageOrigine {
    MessageOrigine {
        identifiant: "<origine-brouillon@cabinet.example>".to_owned(),
        references: vec!["<ancien-brouillon@cabinet.example>".to_owned()],
        objet: "Audience".to_owned(),
        expediteur: "Confrere Fictif <confrere@example.com>".to_owned(),
        a: vec!["Avocat Fictif <avocat@cabinet.example>".to_owned()],
        cc: Vec::new(),
        texte: "Merci de confirmer le creneau.".to_owned(),
        html: "<p>Merci de confirmer le creneau.</p><script>alert(1)</script>".to_owned(),
        pieces: vec![PieceJointe {
            nom: "note-fictive.txt".to_owned(),
            type_mime: "text/plain".to_owned(),
            contenu: b"contenu fictif".to_vec(),
        }],
    }
}

fn demande(identifiant: &str) -> DemandeRedaction {
    DemandeRedaction {
        de: "Avocat Fictif <avocat@cabinet.example>".to_owned(),
        adresse_compte: "avocat@cabinet.example".to_owned(),
        a: Vec::new(),
        cc: Vec::new(),
        cci: Vec::new(),
        objet: "Audience".to_owned(),
        corps: "Texte nouveau du cabinet.".to_owned(),
        html: String::new(),
        signature: "SignatureFictiveJ11".to_owned(),
        identifiant: identifiant.to_owned(),
        origine: Some(origine()),
        pieces: Vec::new(),
    }
}

fn verrouiller() -> std::sync::MutexGuard<'static, ()> {
    // GreenMail 2.1 sur un seul compte ne supporte pas deux sessions
    // qui APPEND et FETCH le même dossier en parallèle.
    static VERROU: std::sync::Mutex<()> = std::sync::Mutex::new(());
    match VERROU.lock() {
        Ok(garde) => garde,
        Err(empoisonne) => empoisonne.into_inner(),
    }
}

fn assurer_greenmail() {
    if TcpStream::connect(("127.0.0.1", 23_143)).is_ok() {
        return;
    }
    let _ = Command::new("docker")
        .args(["rm", "-f", "legalos-j11-brouillon"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let statut = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name",
            "legalos-j11-brouillon",
            "-p",
            "127.0.0.1:23143:3143",
            "-e",
            "GREENMAIL_OPTS=-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=redacteur:MotDePasseRedaction123!",
            "greenmail/standalone:2.1.0",
        ])
        .output()
        .unwrap_or_else(|err| panic!("docker indisponible pour le brouillon J11 : {err}"));
    if !statut.status.success() {
        panic!(
            "GreenMail 23143 n'a pas démarré : {}",
            String::from_utf8_lossy(&statut.stderr)
        );
    }
    for _ in 0..40 {
        if TcpStream::connect(("127.0.0.1", 23_143)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(500));
    }
    panic!("GreenMail 23143 n'accepte pas de connexion");
}

fn connecter() -> SessionActions {
    assurer_greenmail();
    let mut dernier = String::from("connexion");
    for _ in 0..40 {
        match SessionActions::connecter(&parametres()) {
            Ok(session) => return session,
            Err(err) => {
                dernier = err.to_string();
                thread::sleep(Duration::from_millis(500));
            }
        }
    }
    panic!(
        "GreenMail 2.1.0 injoignable sur 127.0.0.1:23143 (image greenmail/standalone:2.1.0, utilisateur fictif redacteur) : {dernier}"
    );
}

#[test]
fn brouillon_reponse_depose_dans_brouillons() {
    let _garde = verrouiller();
    let mut session = connecter();
    let identifiant = "<brouillon-reponse-j11@cabinet.example>";
    let octets =
        construire_message(GenreRedaction::Reponse, &demande(identifiant)).expect("construction");
    session
        .appender(DOSSIER_BROUILLONS, &octets)
        .expect("append brouillon");
    assert!(
        session
            .message_id_present(DOSSIER_BROUILLONS, identifiant)
            .expect("recherche"),
        "le brouillon doit être retrouvé par son identifiant"
    );
    let (_validite, entetes) = session
        .relever_entetes(DOSSIER_BROUILLONS, None, None)
        .expect("releve");
    let entete = entetes
        .iter()
        .find(|e| e.message_id.contains("brouillon-reponse-j11"))
        .expect("en-tete du brouillon");
    assert!(
        entete.pieces.is_empty(),
        "une réponse ne reprend pas les pièces d'origine"
    );
    assert!(entete.objet.contains("Re:"));
    let corps = session
        .lire_corps(DOSSIER_BROUILLONS, entete.uid)
        .expect("corps");
    assert!(corps.texte.contains("Texte nouveau du cabinet."));
    assert!(corps.texte.contains("SignatureFictiveJ11"));
    assert!(corps.texte.contains("a écrit :"));
    assert!(corps.texte.contains("confirmer le creneau"));
    assert!(corps.html.to_ascii_lowercase().contains("blockquote"));
    assert!(corps.html.contains("confirmer le creneau"));
    assert!(!corps.html.to_ascii_lowercase().contains("<script"));
    assert!(!corps.html.contains("alert"));
}

#[test]
fn brouillon_transfert_conserve_la_piece() {
    let _garde = verrouiller();
    let mut session = connecter();
    let identifiant = "<brouillon-transfert-j11@cabinet.example>";
    let mut demande = demande(identifiant);
    demande.a = vec!["destinataire@example.com".to_owned()];
    let octets = construire_message(GenreRedaction::Transfert, &demande).expect("construction");
    session
        .appender(DOSSIER_BROUILLONS, &octets)
        .expect("append transfert");
    let (_validite, entetes) = session
        .relever_entetes(DOSSIER_BROUILLONS, None, None)
        .expect("releve");
    let entete = entetes
        .iter()
        .find(|e| e.message_id.contains("brouillon-transfert-j11"))
        .expect("en-tete du transfert");
    assert!(
        entete.pieces.iter().any(|nom| nom == "note-fictive.txt"),
        "le transfert conserve la pièce d'origine, pièces vues : {:?}",
        entete.pieces
    );
    assert!(entete.objet.contains("Fwd:"));
    let corps = session
        .lire_corps(DOSSIER_BROUILLONS, entete.uid)
        .expect("corps");
    assert!(corps.texte.contains("a écrit :"));
    assert!(corps.texte.contains("confirmer le creneau"));
    assert!(corps.html.contains("confirmer le creneau"));
}
