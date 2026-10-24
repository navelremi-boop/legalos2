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
        jeton_acces: None,
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

/// Lecture des corps de l'indexation de fond (`textes_sans_effet`) sur chacun des deux serveurs de test : un message
/// déposé dans le dossier des brouillons est relu, son texte est rendu. GreenMail 2.x écrit `BODY[]<0>{n}` sans espace :
/// la lecture partielle ne rend rien et le repli par message entier le lit. Cas d'un UID absent : rendu sans texte, pas
/// d'erreur ; UIDVALIDITY périmée : rien n'est lu, sans erreur.
fn lire_un_corps_sans_effet(port: u16) {
    let adresse: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    exiger_ou_passer(adresse);
    if !joignable(adresse) {
        return;
    }
    let mut session = SessionActions::connecter(&compte(port)).expect("serveur");
    let dossier = session
        .dossier_brouillons()
        .expect("dossier des brouillons");
    let mot = format!("indexation{}", std::process::id());
    let message = format!(
        "From: a@example.com\r\nTo: b@example.com\r\nSubject: Indexation\r\nMessage-ID: <{mot}@example.com>\r\n\r\nCorps du message {mot} pour la lecture sans effet.\r\n"
    );
    session
        .deposer_brouillon(
            &dossier,
            &format!("<{mot}@example.com>"),
            message.as_bytes(),
        )
        .expect("dépôt");
    let releve = session.synchroniser_dossier(&dossier, 0).expect("relève");
    let uid = releve
        .etats
        .iter()
        .map(|e| e.uid)
        .max()
        .expect("un message");
    let lus = session
        .textes_sans_effet(&dossier, releve.uid_validity, &[uid, uid + 1000])
        .expect("lecture des corps");
    assert!(lus.valide, "la UIDVALIDITY est celle du dossier");
    let texte = lus.textes.get(&uid).expect("le texte du message déposé");
    assert!(texte.contains(&mot), "texte lu : {texte}");
    assert!(
        !lus.textes.contains_key(&(uid + 1000)),
        "un UID absent n'a pas de texte"
    );
    // Une UIDVALIDITY périmée n'est pas une erreur : rien n'est lu, `valide` est faux.
    let perime = session
        .textes_sans_effet(&dossier, releve.uid_validity.wrapping_add(1), &[uid])
        .expect("lecture avec une UIDVALIDITY périmée");
    assert!(!perime.valide && perime.textes.is_empty());
}

#[test]
fn dovecot_textes_sans_effet_lisent_un_corps() {
    lire_un_corps_sans_effet(1143);
}

#[test]
fn greenmail_textes_sans_effet_lisent_un_corps() {
    lire_un_corps_sans_effet(3143);
}

/// Même lecture dans `INBOX`, avec des UID absents de part et d'autre du message déposé (messages supprimés ou déplacés
/// par d'autres recettes : cas de la boîte de classement de l'instance de développement).
#[test]
fn greenmail_textes_sans_effet_dans_inbox_avec_des_uid_absents() {
    let adresse: SocketAddr = "127.0.0.1:3143".parse().unwrap();
    exiger_ou_passer(adresse);
    if !joignable(adresse) {
        return;
    }
    let mut session = SessionActions::connecter(&compte(3143)).expect("greenmail");
    let mot = format!("inbox{}", std::process::id());
    let message = format!(
        "From: a@example.com\r\nTo: b@example.com\r\nSubject: Inbox\r\nMessage-ID: <{mot}@example.com>\r\n\r\nCorps {mot}.\r\n"
    );
    session
        .deposer_brouillon("INBOX", &format!("<{mot}@example.com>"), message.as_bytes())
        .expect("dépôt");
    let releve = session.synchroniser_dossier("INBOX", 0).expect("relève");
    let uid = releve
        .etats
        .iter()
        .map(|e| e.uid)
        .max()
        .expect("un message");
    let lus = session
        .textes_sans_effet("INBOX", releve.uid_validity, &[1, 2, 4, uid, uid + 50])
        .expect("lecture avec des UID absents");
    assert!(lus.valide);
    assert!(
        lus.textes.get(&uid).is_some_and(|t| t.contains(&mot)),
        "le message présent est lu malgré les UID absents : {:?}",
        lus.textes.keys().collect::<Vec<_>>()
    );
    // Que des UID absents : rien à lire, aucune erreur.
    let vides = session
        .textes_sans_effet("INBOX", releve.uid_validity, &[2, 4, uid + 50])
        .expect("que des UID absents");
    assert!(vides.valide && vides.textes.is_empty());
}
