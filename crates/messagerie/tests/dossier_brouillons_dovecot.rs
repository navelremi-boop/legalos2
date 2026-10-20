//! Dossier des brouillons annoncé par le serveur (attribut spécial `\Drafts`), contre Dovecot 2.3.
//!
//! Le dossier « Ebauches » porte l'attribut `\Drafts` (`instance/imap-test/dovecot-brouillons.conf`) :
//! l'attribut doit l'emporter sur les noms usuels, et rien ne doit être déposé dans « Brouillons ».
//! Conteneur dédié, port hôte 24143, démarré à la demande ; son absence est un échec (le test n'est
//! pas ignoré).

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::net::TcpStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use legalos_messagerie::{
    construire_message_brouillon, DemandeRedaction, ParametresCompte, SessionActions,
    DOSSIER_BROUILLONS,
};

const PORT: u16 = 24_143;

fn parametres() -> ParametresCompte {
    ParametresCompte {
        hote: "127.0.0.1".to_owned(),
        port: PORT,
        utilisateur: "capa".to_owned(),
        mot_de_passe: "MotDePasseCapa123!".to_owned(),
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
    let configuration = racine.join("instance/imap-test/dovecot-brouillons.conf");
    let _ = Command::new("docker")
        .args(["rm", "-f", "legalos-j11-dovecot-brouillons"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let lancement = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name",
            "legalos-j11-dovecot-brouillons",
            "-p",
            "127.0.0.1:24143:143",
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

fn connecter() -> SessionActions {
    assurer_dovecot();
    (0..40)
        .find_map(|_| match SessionActions::connecter(&parametres()) {
            Ok(session) => Some(session),
            Err(_) => {
                thread::sleep(Duration::from_millis(500));
                None
            }
        })
        .expect("Dovecot injoignable sur 127.0.0.1:24143")
}

fn brouillon(identifiant: &str, corps: &str) -> Vec<u8> {
    let demande = DemandeRedaction {
        de: "Avocat Fictif <avocat@cabinet.example>".to_owned(),
        adresse_compte: "avocat@cabinet.example".to_owned(),
        a: vec!["destinataire@example.com".to_owned()],
        cc: Vec::new(),
        cci: Vec::new(),
        objet: "Brouillon fictif".to_owned(),
        corps: corps.to_owned(),
        html: String::new(),
        signature: String::new(),
        signature_html: String::new(),
        repondre_a: String::new(),
        identifiant: identifiant.to_owned(),
        origine: None,
        pieces: Vec::new(),
    };
    construire_message_brouillon(&demande, None).expect("construction")
}

#[test]
fn l_attribut_special_drafts_l_emporte_sur_les_noms_usuels() {
    let mut session = connecter();
    let dossier = session
        .dossier_brouillons()
        .expect("dossier des brouillons");
    assert_eq!(
        dossier, "Ebauches",
        "le serveur annonce \\Drafts sur ce dossier"
    );
    assert_ne!(dossier, DOSSIER_BROUILLONS);

    let identifiant = "<dovecot-brouillon-j11@cabinet.example>";
    session
        .retirer_message_id(&dossier, identifiant)
        .expect("nettoyage");
    session
        .deposer_brouillon(
            &dossier,
            identifiant,
            &brouillon(identifiant, "Version un."),
        )
        .expect("depot 1");
    let retirees = session
        .deposer_brouillon(
            &dossier,
            identifiant,
            &brouillon(identifiant, "Version deux."),
        )
        .expect("depot 2");
    assert_eq!(retirees, 1, "la version précédente est retirée");

    let uids = session
        .uids_message_id(&dossier, identifiant)
        .expect("uids");
    assert_eq!(uids.len(), 1, "une seule copie");
    assert_eq!(
        session.drapeaux(&dossier, uids[0]).expect("drapeaux"),
        "\\Draft \\Seen"
    );
    assert!(session
        .lire_corps(&dossier, uids[0])
        .expect("corps")
        .texte
        .contains("Version deux."));
    // Essai négatif : rien n'a été déposé dans le dossier par défaut.
    assert!(
        session
            .uids_message_id(DOSSIER_BROUILLONS, identifiant)
            .expect("recherche")
            .is_empty(),
        "aucune copie dans « Brouillons »"
    );
    assert_eq!(
        session
            .retirer_message_id(&dossier, identifiant)
            .expect("retrait"),
        1
    );
    assert!(session
        .uids_message_id(&dossier, identifiant)
        .expect("uids")
        .is_empty());
}
