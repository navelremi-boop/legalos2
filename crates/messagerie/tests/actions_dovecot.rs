//! Actions sur les messages d'une boîte (J11, critère iii), contre Dovecot 2.3 : lu / non lu,
//! déplacement rejouable, Corbeille, dossiers à usage spécial.
//!
//! Trois configurations du même serveur couvrent les trois chemins du déplacement :
//!
//! * `dovecot-actions.conf` : MOVE (RFC 6851) et UIDPLUS annoncés ;
//! * `dovecot-actions-copie.conf` : pas de MOVE, UIDPLUS annoncé (COPY, `\Deleted`, UID EXPUNGE
//!   de l'original seul) ;
//! * `dovecot-actions-copie-sans-uidplus.conf` : ni MOVE ni UIDPLUS (COPY, `\Deleted` ; l'original
//!   n'est jamais expurgé).
//!
//! Conteneurs dédiés, démarrés à la demande ; l'absence de Docker est un échec (le test n'est pas
//! ignoré). Chaque test a ses identifiants de message et ses dossiers : ils tournent en parallèle.

#![allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]

use std::net::TcpStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use legalos_messagerie::{
    ErreurMail, FournisseurMail, IssueDeplacement, ParametresCompte, SessionActions,
    DOSSIER_ARCHIVES, DOSSIER_CORBEILLE,
};

#[derive(Clone, Copy)]
struct Banc {
    port: u16,
    nom: &'static str,
    configuration: &'static str,
}

const AVEC_MOVE: Banc = Banc {
    port: 24_144,
    nom: "legalos-j11-dovecot-actions",
    configuration: "dovecot-actions.conf",
};
const SANS_MOVE: Banc = Banc {
    port: 24_145,
    nom: "legalos-j11-dovecot-actions-copie",
    configuration: "dovecot-actions-copie.conf",
};
const SANS_UIDPLUS: Banc = Banc {
    port: 24_146,
    nom: "legalos-j11-dovecot-actions-sans-uidplus",
    configuration: "dovecot-actions-copie-sans-uidplus.conf",
};

/// Un seul démarrage de conteneur à la fois : deux tests du même banc ne le lancent pas deux fois.
static DEMARRAGE: Mutex<()> = Mutex::new(());

fn parametres(banc: Banc) -> ParametresCompte {
    ParametresCompte {
        hote: "127.0.0.1".to_owned(),
        port: banc.port,
        utilisateur: "capa".to_owned(),
        mot_de_passe: "MotDePasseCapa123!".to_owned(),
        tls: false,
        jeton_acces: None,
    }
}

fn assurer_dovecot(banc: Banc) {
    let _garde = DEMARRAGE.lock().unwrap_or_else(|err| err.into_inner());
    if TcpStream::connect(("127.0.0.1", banc.port)).is_ok() {
        return;
    }
    let racine = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("racine du dépôt");
    let configuration = racine.join("instance/imap-test").join(banc.configuration);
    let _ = Command::new("docker")
        .args(["rm", "-f", banc.nom])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let lancement = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name",
            banc.nom,
            "-p",
            &format!("127.0.0.1:{}:143", banc.port),
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
        let ouvert = TcpStream::connect(("127.0.0.1", banc.port)).is_ok();
        if !ouvert {
            thread::sleep(Duration::from_millis(500));
        }
        ouvert
    });
    assert!(
        joignable,
        "Dovecot {} n'accepte pas de connexion",
        banc.port
    );
}

fn connecter(banc: Banc) -> SessionActions {
    assurer_dovecot(banc);
    (0..40)
        .find_map(|_| match SessionActions::connecter(&parametres(banc)) {
            Ok(session) => Some(session),
            Err(_) => {
                thread::sleep(Duration::from_millis(500));
                None
            }
        })
        .expect("Dovecot injoignable")
}

/// Identifiant de message propre à ce passage : les conteneurs gardent leurs boîtes d'un passage à
/// l'autre, un identifiant fixe y retrouverait les messages du passage précédent.
fn nouvel_id(nom: &str) -> String {
    static SUFFIXE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    let suffixe = SUFFIXE.get_or_init(|| {
        let instant = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        format!("{}-{instant}", std::process::id())
    });
    format!("<j11-actions-{nom}-{suffixe}@legalos.test>")
}

fn brut(identifiant: &str) -> Vec<u8> {
    format!(
        "From: expediteur.fictif@example.com\r\nTo: capa@localhost\r\nSubject: Message fictif\r\n\
         Message-ID: {identifiant}\r\n\r\nCorps fictif.\r\n"
    )
    .into_bytes()
}

/// Dépose le message dans INBOX et rend sa position (UIDVALIDITY, UID).
fn deposer(session: &mut SessionActions, identifiant: &str) -> (u32, u32) {
    session
        .appender("INBOX", &brut(identifiant))
        .expect("dépôt dans INBOX");
    // Génération du dossier sans rien relever (limite 0) : les tests partagent la réception, un
    // message déplacé par un autre test pendant une relève complète la ferait échouer.
    let (validite, _) = session
        .relever_entetes("INBOX", None, Some(0))
        .expect("UIDVALIDITY de INBOX");
    let uid = session
        .uids_message_id("INBOX", identifiant)
        .expect("recherche")
        .first()
        .copied()
        .expect("message déposé");
    (validite, uid)
}

fn copies(session: &mut SessionActions, dossier: &str, identifiant: &str) -> usize {
    session
        .uids_message_id(dossier, identifiant)
        .expect("recherche")
        .len()
}

fn drapeaux_du_premier(session: &mut SessionActions, dossier: &str, identifiant: &str) -> String {
    let uid = session
        .uids_message_id(dossier, identifiant)
        .expect("recherche")
        .first()
        .copied()
        .expect("le message est là");
    session.drapeaux(dossier, uid).expect("drapeaux")
}

fn place(issue: IssueDeplacement) -> (u32, Option<u32>, bool) {
    match issue {
        IssueDeplacement::Place {
            emplacement,
            deja_fait,
        } => (emplacement.uid_validity, emplacement.uid, deja_fait),
        IssueDeplacement::Introuvable => panic!("message introuvable"),
    }
}

/// Déplacement, puis rejeu, sur un serveur : une seule copie à la destination, l'original retiré
/// (`original_retire`) ou marqué `\Deleted` sans être expurgé.
fn deplacer_puis_rejouer(banc: Banc, identifiant: &str, destination: &str, original_retire: bool) {
    let mut session = connecter(banc);
    let (validite, uid) = deposer(&mut session, identifiant);

    let premier = place(
        session
            .deplacer_message("INBOX", validite, uid, identifiant, destination)
            .expect("déplacement"),
    );
    assert!(!premier.2, "le premier passage déplace vraiment");
    assert_eq!(copies(&mut session, destination, identifiant), 1);
    // Le COPYUID du serveur donne le nouvel UID du message à sa destination.
    let nouvel_uid = premier.1.expect("UID à la destination");
    assert_eq!(
        session
            .uids_message_id(destination, identifiant)
            .expect("uids"),
        vec![nouvel_uid]
    );
    if original_retire {
        assert_eq!(
            copies(&mut session, "INBOX", identifiant),
            0,
            "original retiré"
        );
    } else {
        // Ni MOVE ni UIDPLUS : l'original reste, marqué, jamais expurgé.
        assert_eq!(copies(&mut session, "INBOX", identifiant), 1);
        assert!(drapeaux_du_premier(&mut session, "INBOX", identifiant).contains("\\Deleted"));
    }
    // Aucun message n'est marqué \Deleted à la destination.
    assert!(!drapeaux_du_premier(&mut session, destination, identifiant).contains("\\Deleted"));

    // Rejeu avec les anciens indices (UID de l'origine) : rien n'est recopié.
    let rejeu = place(
        session
            .deplacer_message("INBOX", validite, uid, identifiant, destination)
            .expect("rejeu"),
    );
    assert!(
        rejeu.2 || !original_retire,
        "le rejeu retrouve le message à sa destination"
    );
    assert_eq!(
        copies(&mut session, destination, identifiant),
        1,
        "aucun doublon au rejeu"
    );
}

#[test]
fn deplacer_avec_move_puis_rejouer_sans_doublon() {
    deplacer_puis_rejouer(AVEC_MOVE, &nouvel_id("move-1"), "Suivi MOVE", true);
}

#[test]
fn deplacer_sans_move_copie_puis_retire_l_original_seul() {
    deplacer_puis_rejouer(SANS_MOVE, &nouvel_id("copie-1"), "Suivi COPY", true);
}

#[test]
fn deplacer_sans_move_ni_uid_plus_marque_l_original_sans_l_expurger() {
    deplacer_puis_rejouer(
        SANS_UIDPLUS,
        &nouvel_id("copie-2"),
        "Suivi COPY sans UIDPLUS",
        false,
    );
}

#[test]
fn un_autre_message_marque_supprime_n_est_pas_expurge_par_un_deplacement() {
    // Sans MOVE, le retrait de l'original ne vise que son UID : un message qu'un autre client a
    // marqué \Deleted sans l'expurger reste en place.
    let mut session = connecter(SANS_MOVE);
    let (validite, uid) = deposer(&mut session, &nouvel_id("voisin-a"));
    let (_, voisin) = deposer(&mut session, &nouvel_id("voisin-b"));
    session
        .poser_drapeau("INBOX", voisin, "\\Deleted")
        .expect("marquage du voisin");
    session
        .deplacer_message(
            "INBOX",
            validite,
            uid,
            &nouvel_id("voisin-a"),
            "Suivi voisin",
        )
        .expect("déplacement");
    assert_eq!(
        copies(&mut session, "INBOX", &nouvel_id("voisin-b")),
        1,
        "le voisin marqué \\Deleted n'est pas expurgé"
    );
    assert_eq!(copies(&mut session, "INBOX", &nouvel_id("voisin-a")), 0);
}

#[test]
fn rejeu_apres_une_copie_interrompue_ne_duplique_pas() {
    // La tentative précédente a copié le message puis s'est arrêtée avant de retirer l'original.
    let mut session = connecter(SANS_MOVE);
    let identifiant = &nouvel_id("interrompu");
    let (validite, uid) = deposer(&mut session, identifiant);
    session
        .appender("Suivi interrompu", &brut(identifiant))
        .expect("copie déjà faite");
    assert_eq!(copies(&mut session, "Suivi interrompu", identifiant), 1);

    let (_, _, deja) = place(
        session
            .deplacer_message("INBOX", validite, uid, identifiant, "Suivi interrompu")
            .expect("reprise"),
    );
    assert!(!deja, "l'original était encore là : il est retiré");
    assert_eq!(
        copies(&mut session, "Suivi interrompu", identifiant),
        1,
        "la copie déjà faite n'est pas refaite"
    );
    assert_eq!(copies(&mut session, "INBOX", identifiant), 0);
}

#[test]
fn rejeu_apres_un_deplacement_fait_par_un_autre_client() {
    // L'original n'existe plus, le message est déjà à destination : l'action est quitte.
    let mut session = connecter(AVEC_MOVE);
    let identifiant = &nouvel_id("deja");
    let (validite, uid) = deposer(&mut session, identifiant);
    session
        .deplacer_message("INBOX", validite, uid, identifiant, "Suivi deja")
        .expect("premier déplacement");
    let (_, uid_destination, deja) = place(
        session
            .deplacer_message("INBOX", validite, uid, identifiant, "Suivi deja")
            .expect("rejeu"),
    );
    assert!(deja);
    assert!(uid_destination.is_some());
    assert_eq!(copies(&mut session, "Suivi deja", identifiant), 1);
}

#[test]
fn un_message_absent_partout_est_introuvable() {
    let mut session = connecter(AVEC_MOVE);
    let issue = session
        .deplacer_message("INBOX", 1, 424_242, &nouvel_id("fantome"), "Suivi fantome")
        .expect("déplacement");
    assert_eq!(issue, IssueDeplacement::Introuvable);
    assert!(!session
        .marquer_lu_message("INBOX", 1, 424_242, &nouvel_id("fantome"), true)
        .expect("lu"));
    // Un serveur qui bégaie n'est pas un message absent : l'erreur d'authentification reste une erreur.
    let mauvais = ParametresCompte {
        mot_de_passe: "Mauvais".to_owned(),
        ..parametres(AVEC_MOVE)
    };
    assert!(matches!(
        SessionActions::connecter(&mauvais),
        Err(ErreurMail::Authentification)
    ));
}

#[test]
fn un_uid_reattribue_n_est_pas_le_bon_message() {
    // L'UID connu désigne un autre message (réattribué après changement de UIDVALIDITY) : le
    // message visé est retrouvé par son Message-ID, l'autre n'est pas touché.
    let mut session = connecter(AVEC_MOVE);
    let (validite, uid_autre) = deposer(&mut session, &nouvel_id("autre"));
    let visee = &nouvel_id("visee");
    let (_, _uid_vise) = deposer(&mut session, visee);

    let (_, _, deja) = place(
        session
            .deplacer_message("INBOX", validite, uid_autre, visee, "Suivi reattribue")
            .expect("déplacement"),
    );
    assert!(!deja);
    assert_eq!(copies(&mut session, "Suivi reattribue", visee), 1);
    assert_eq!(copies(&mut session, "INBOX", visee), 0);
    assert_eq!(
        copies(&mut session, "INBOX", &nouvel_id("autre")),
        1,
        "le message qui portait l'UID est resté en place"
    );
    // Même chose pour la lecture.
    assert!(session
        .marquer_lu_message("INBOX", validite, uid_autre, &nouvel_id("autre"), true)
        .expect("lu"));
    assert!(drapeaux_du_premier(&mut session, "INBOX", &nouvel_id("autre")).contains("\\Seen"));
}

#[test]
fn marquer_lu_et_non_lu_se_rejoue_et_se_verifie() {
    let mut session = connecter(AVEC_MOVE);
    let identifiant = &nouvel_id("lu");
    let (validite, uid) = deposer(&mut session, identifiant);
    assert!(!drapeaux_du_premier(&mut session, "INBOX", identifiant).contains("\\Seen"));

    for _ in 0..2 {
        assert!(session
            .marquer_lu_message("INBOX", validite, uid, identifiant, true)
            .expect("lu"));
        assert!(drapeaux_du_premier(&mut session, "INBOX", identifiant).contains("\\Seen"));
    }
    for _ in 0..2 {
        assert!(session
            .marquer_lu_message("INBOX", validite, uid, identifiant, false)
            .expect("non lu"));
        assert!(!drapeaux_du_premier(&mut session, "INBOX", identifiant).contains("\\Seen"));
    }
    // UIDVALIDITY changée et UID perdu : le message est retrouvé par son Message-ID.
    assert!(session
        .marquer_lu_message("INBOX", validite.wrapping_add(7), 0, identifiant, true)
        .expect("lu sans indice"));
    assert!(drapeaux_du_premier(&mut session, "INBOX", identifiant).contains("\\Seen"));
}

#[test]
fn les_dossiers_a_usage_special_annonces_par_le_serveur_l_emportent() {
    let mut session = connecter(AVEC_MOVE);
    assert_eq!(session.dossier_corbeille().expect("corbeille"), "Poubelle");
    assert_eq!(
        session.dossier_archives().expect("archives"),
        "Conservation"
    );
    assert_ne!(
        session.dossier_corbeille().expect("corbeille"),
        DOSSIER_CORBEILLE
    );
    assert_ne!(
        session.dossier_archives().expect("archives"),
        DOSSIER_ARCHIVES
    );
}

#[test]
fn supprimer_deplace_vers_la_corbeille_sans_jamais_expurger() {
    for banc in [AVEC_MOVE, SANS_MOVE, SANS_UIDPLUS] {
        let mut session = connecter(banc);
        let identifiant = nouvel_id(&format!("corbeille-{}", banc.port));
        let (validite, uid) = deposer(&mut session, &identifiant);
        let corbeille = session.dossier_corbeille().expect("corbeille");

        session
            .deplacer_message("INBOX", validite, uid, &identifiant, &corbeille)
            .expect("suppression");
        assert_eq!(copies(&mut session, &corbeille, &identifiant), 1);
        assert!(
            !drapeaux_du_premier(&mut session, &corbeille, &identifiant).contains("\\Deleted"),
            "le message de la Corbeille n'est pas marqué"
        );
        // Supprimer un message déjà dans la Corbeille le laisse dans la Corbeille.
        let (_, _, deja) = place(
            session
                .deplacer_message(&corbeille, 0, 0, &identifiant, &corbeille)
                .expect("suppression d'un message déjà supprimé"),
        );
        assert!(deja);
        assert_eq!(copies(&mut session, &corbeille, &identifiant), 1);
        assert!(!drapeaux_du_premier(&mut session, &corbeille, &identifiant).contains("\\Deleted"));
    }
}

#[test]
fn un_dossier_au_nom_accentue_est_cree_et_retrouve() {
    // Nom français (UTF-7 modifié sur le fil) : créé au déplacement, retrouvé au rejeu.
    let mut session = connecter(AVEC_MOVE);
    let identifiant = &nouvel_id("accent");
    let (validite, uid) = deposer(&mut session, identifiant);
    let destination = "Dossier été à suivre";
    session
        .deplacer_message("INBOX", validite, uid, identifiant, destination)
        .expect("déplacement");
    assert_eq!(copies(&mut session, destination, identifiant), 1);
    assert_eq!(copies(&mut session, "INBOX", identifiant), 0);
    let (_, _, deja) = place(
        session
            .deplacer_message("INBOX", validite, uid, identifiant, destination)
            .expect("rejeu"),
    );
    assert!(deja);
    assert_eq!(copies(&mut session, destination, identifiant), 1);
}

const VOLUME: Banc = Banc {
    port: 24_147,
    nom: "legalos-j11-dovecot-actions-volume",
    configuration: "dovecot-actions.conf",
};

/// Remplit la réception de 50 000 messages fictifs en déposant directement les fichiers Maildir
/// dans le conteneur (rapide), puis fait relire la boîte par Dovecot.
fn remplir_volume(total: u32) {
    let remplissage = format!(
        "cd /tmp/mail/capa && mkdir -p new cur tmp && i=1 && while [ $i -le {total} ]; do \
         printf 'From: expediteur.fictif@example.com\r\nTo: capa@localhost\r\nSubject: Volume %d\r\n\
         Message-ID: <volume-%d@legalos.test>\r\n\r\nCorps fictif %d.\r\n' $i $i $i \
         > new/1700000000.M$i.volume; i=$((i+1)); done; chown -R dovecot:dovecot /tmp/mail; \
         doveadm force-resync -u capa INBOX"
    );
    let sortie = Command::new("docker")
        .args(["exec", VOLUME.nom, "sh", "-c", &remplissage])
        .output()
        .expect("docker exec");
    assert!(
        sortie.status.success(),
        "remplissage du volume : {}",
        String::from_utf8_lossy(&sortie.stderr)
    );
}

/// Mesure des actions sur une réception de 50 000 messages. Les durées sont imprimées
/// (`--nocapture`) ; elles sont bornées largement pour qu'une dérive soit vue sans rendre le test
/// dépendant de la machine.
#[test]
fn actions_sur_une_reception_de_50_000_messages() {
    use std::time::Instant;

    // Conteneur neuf à chaque passage : le volume est toujours de 50 000 messages, jamais plus.
    let _ = Command::new("docker")
        .args(["rm", "-f", VOLUME.nom])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    assurer_dovecot(VOLUME);
    let mut session = connecter(VOLUME);
    let debut = Instant::now();
    remplir_volume(50_000);
    let remplissage_ms = debut.elapsed().as_millis();

    let debut = Instant::now();
    let (validite, entetes) = session
        .relever_entetes("INBOX", None, Some(1))
        .expect("première relève bornée");
    let relever_un_ms = debut.elapsed().as_millis();
    assert_eq!(entetes.len(), 1);

    // La boîte compte bien 50 000 messages.
    let debut = Instant::now();
    let total = session.compter_entetes(false).expect("comptage");
    let comptage_ms = debut.elapsed().as_millis();
    assert!(total >= 50_000, "{total} messages");

    // Message du milieu, retrouvé par son UID (indice exact) : une lecture d'en-tête.
    let cible = "<volume-37000@legalos.test>";
    let uid = session
        .uids_message_id("INBOX", cible)
        .expect("recherche du témoin")
        .first()
        .copied()
        .expect("témoin présent");
    let debut = Instant::now();
    assert!(session
        .marquer_lu_message("INBOX", validite, uid, cible, true)
        .expect("lu avec indice"));
    let lu_indice_ms = debut.elapsed().as_millis();

    // Sans indice exploitable (UIDVALIDITY changée) : recherche par Message-ID dans toute la boîte.
    let debut = Instant::now();
    assert!(session
        .marquer_lu_message("INBOX", validite.wrapping_add(1), 0, cible, false)
        .expect("non lu sans indice"));
    let lu_recherche_ms = debut.elapsed().as_millis();

    let debut = Instant::now();
    let issue = session
        .deplacer_message("INBOX", validite, uid, cible, "Volume classe")
        .expect("déplacement avec indice");
    let deplacer_indice_ms = debut.elapsed().as_millis();
    assert!(matches!(
        issue,
        IssueDeplacement::Place {
            deja_fait: false,
            ..
        }
    ));

    // Rejeu avec indice périmé (le message n'est plus à son UID) : retrouvé à destination.
    let debut = Instant::now();
    let rejeu = session
        .deplacer_message("INBOX", validite, uid, cible, "Volume classe")
        .expect("rejeu");
    let rejeu_ms = debut.elapsed().as_millis();
    assert!(matches!(
        rejeu,
        IssueDeplacement::Place {
            deja_fait: true,
            ..
        }
    ));
    assert_eq!(copies(&mut session, "Volume classe", cible), 1);

    println!(
        "volume actions messages={total} remplissage_ms={remplissage_ms} releve_un_ms={relever_un_ms} \
         comptage_en_tetes_ms={comptage_ms} lu_avec_indice_ms={lu_indice_ms} \
         lu_par_recherche_ms={lu_recherche_ms} deplacer_avec_indice_ms={deplacer_indice_ms} \
         rejeu_apres_deplacement_ms={rejeu_ms}"
    );
    assert!(lu_indice_ms < 3_000, "lu avec indice : {lu_indice_ms} ms");
    assert!(
        deplacer_indice_ms < 3_000,
        "déplacement avec indice : {deplacer_indice_ms} ms"
    );
    assert!(
        lu_recherche_ms < 60_000,
        "recherche par Message-ID : {lu_recherche_ms} ms"
    );
    let _ = Command::new("docker")
        .args(["rm", "-f", VOLUME.nom])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
