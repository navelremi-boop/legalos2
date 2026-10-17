//! J11 étape 2 : invitations de calendrier reçues par mail, contre un Postgres réel.
//!
//! Enregistrement par la relève (SEQUENCE, annulation, fuseaux), lecture réservée au titulaire,
//! réponse iTIP envoyée à l'organisateur par la file d'envoi (idempotente). Aucun serveur IMAP ni
//! SMTP n'est joignable ici (ports fermés) : les réponses restent dans la file, ce qui exerce
//! aussi la reprise. La relève réelle depuis GreenMail, l'envoi réel et le flux PowerSync sont
//! couverts par `tests/recette/j11-invitation.mjs` et `tests/recette/s5-sync-streams.mjs`.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use legalos_api::config::{Config, ParametresMessagerie};
use legalos_api::invitations::{enregistrer_invitation, InvitationRecue, IssueInvitation};
use legalos_api::{build_app_state, build_router};
use legalos_messagerie::{lire_invitation, VerdictOrigine};
use serde_json::{json, Value};
use totp_rs::{Algorithm, Builder, Secret, Totp};
use tower::ServiceExt;
use uuid::Uuid;

#[path = "support/mod.rs"]
mod support;

use support::demo_seed::{DEMO_CABINET_ID, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32};

const COLLAB_EMAIL: &str = "collaborateur-invitations@cabinet-fictif.example";
const COLLAB_TOTP: &str = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
const CLE: &[u8; 32] = b"legalos_demo_chiffrement_32oct!!";
const ORGANISATEUR: &str = "organisateur@example.com";

fn environnement() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = dotenvy::dotenv();
        if std::env::var("DATABASE_URL").is_err() {
            let _ = dotenvy::from_filename("../../.env");
        }
        std::env::set_var(
            "SECRETS_CHIFFREMENT_KEY",
            "legalos_demo_chiffrement_32oct!!",
        );
        std::env::set_var("LEGALOS_MODE", "development");
    });
}

fn remplacer_base(database_url: &str, base: &str) -> String {
    let (tete, _) = database_url
        .rsplit_once('/')
        .expect("DATABASE_URL sans nom de base");
    let tete = tete.split('?').next().expect("url");
    format!("{tete}/{base}")
}

fn code_totp(secret_base32: &str, compte: &str) -> String {
    let secret = Secret::try_from_base32(secret_base32).expect("secret");
    let totp: Totp = Builder::new()
        .with_secret(secret.as_bytes().to_vec())
        .with_algorithm(Algorithm::SHA1)
        .with_account_name(compte)
        .with_issuer(Some("LEGAL OS"))
        .build()
        .expect("totp");
    totp.generate_current().to_string()
}

async fn corps(reponse: axum::response::Response) -> Value {
    let octets = reponse
        .into_body()
        .collect()
        .await
        .expect("corps")
        .to_bytes();
    serde_json::from_slice(&octets).unwrap_or(Value::Null)
}

async fn appel(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    jeton: &str,
    contenu: Value,
) -> (StatusCode, Value) {
    let corps_json = if contenu.is_null() {
        Body::empty()
    } else {
        Body::from(contenu.to_string())
    };
    let reponse = app
        .clone()
        .oneshot(
            Request::builder()
                .method(methode)
                .uri(uri)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {jeton}"))
                .body(corps_json)
                .unwrap(),
        )
        .await
        .unwrap();
    let statut = reponse.status();
    (statut, corps(reponse).await)
}

async fn jeton(app: &axum::Router, email: &str, totp: &str) -> String {
    let connexion = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/connexion")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email": email, "password": DEMO_PASSWORD, "nom_appareil": "test-invitations"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(connexion.status(), StatusCode::OK);
    let session = corps(connexion).await["session_token"]
        .as_str()
        .expect("session")
        .to_owned();
    let verification = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/totp/verifier")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"session_token": session, "code_totp": code_totp(totp, email)})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(verification.status(), StatusCode::OK);
    corps(verification).await["access_token"]
        .as_str()
        .expect("jeton")
        .to_owned()
}

async fn creer_utilisateur(pool: &sqlx::PgPool, cabinet: Uuid, id: Uuid, email: &str, totp: &str) {
    let hash = legalos_api::auth::password::hash_password(DEMO_PASSWORD).expect("hash");
    let secret = legalos_api::auth::totp::chiffrer_secret_totp(totp.as_bytes(), CLE).expect("totp");
    sqlx::query(
        "INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif) VALUES ($1, $2, $3, $4, $5, TRUE)",
    )
    .bind(id)
    .bind(cabinet)
    .bind(email)
    .bind(hash)
    .bind(secret)
    .execute(pool)
    .await
    .expect("utilisateur");
}

async fn creer_compte(
    pool: &sqlx::PgPool,
    cabinet: Uuid,
    type_compte: &str,
    titulaire: Option<Uuid>,
    adresse: &str,
) -> Uuid {
    let id = Uuid::now_v7();
    // Depuis l'identité d'envoi (J11 i), un envoi part du compte choisi : sa copie « Envoyés » passe
    // par les identifiants IMAP du compte, qu'un compte réel porte toujours. Port fermé : le serveur
    // est injoignable, l'envoi reste dans la file.
    let secret =
        legalos_api::auth::totp::chiffrer_secret_totp(b"MotDePasseFictif", CLE).expect("secret");
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref, hote, port, utilisateur, tls, secret_chiffre) VALUES ($1, $2, $3, $4, $5, 'test', '127.0.0.1', 1, 'test', FALSE, $6)",
    )
    .bind(id)
    .bind(cabinet)
    .bind(type_compte)
    .bind(titulaire)
    .bind(adresse)
    .bind(secret)
    .execute(pool)
    .await
    .expect("compte");
    id
}

/// Invitation fictive. `debut` est la ligne `DTSTART…` complète.
fn ics(methode: &str, uid: &str, sequence: u32, debut: &str, objet: &str) -> String {
    format!(
        "BEGIN:VCALENDAR\r\nMETHOD:{methode}\r\nBEGIN:VEVENT\r\nUID:{uid}\r\nSEQUENCE:{sequence}\r\n{debut}\r\nSUMMARY:{objet}\r\nORGANIZER:mailto:{ORGANISATEUR}\r\nATTENDEE:mailto:avocat-a@cabinet.example\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    )
}

struct Cadre {
    pool: sqlx::PgPool,
    cabinet: Uuid,
    titulaire: Uuid,
    compte: Uuid,
}

impl Cadre {
    /// Invitation reçue de l'organisateur lui-même (`From` = `ORGANIZER`).
    async fn recevoir(&self, texte: &str, message_id: &str) -> IssueInvitation {
        self.recevoir_de(texte, message_id, &[ORGANISATEUR]).await
    }

    /// Invitation reçue d'un message dont `From` / `Sender` sont `expediteurs`.
    async fn recevoir_de(
        &self,
        texte: &str,
        message_id: &str,
        expediteurs: &[&str],
    ) -> IssueInvitation {
        let mut lue = lire_invitation(texte).expect("invitation lisible");
        lue.expediteurs = expediteurs.iter().map(|e| (*e).to_owned()).collect();
        enregistrer_invitation(
            &self.pool,
            &InvitationRecue {
                cabinet_id: self.cabinet,
                titulaire_id: self.titulaire,
                compte_id: self.compte,
                message_id,
                lue: &lue,
            },
        )
        .await
        .expect("enregistrement")
    }

    async fn ligne(&self, uid: &str) -> (i32, String, String, Option<String>, i64, Option<String>) {
        sqlx::query_as(
            "SELECT sequence, effet, debut, debut_utc, revision, reponse FROM invitations_agenda WHERE titulaire_id = $1 AND uid_ical = $2",
        )
        .bind(self.titulaire)
        .bind(uid)
        .fetch_one(&self.pool)
        .await
        .expect("ligne d'invitation")
    }

    async fn instants(&self, uid: &str) -> (Option<String>, Option<String>) {
        sqlx::query_as("SELECT debut_utc, fin_utc FROM invitations_agenda WHERE titulaire_id = $1 AND uid_ical = $2")
            .bind(self.titulaire)
            .bind(uid)
            .fetch_one(&self.pool)
            .await
            .expect("instants")
    }
}

#[tokio::test]
async fn invitations_releve_reponse_et_droits() {
    environnement();
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL requis (Postgres réel)");
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&remplacer_base(&url, "postgres"))
        .await
        .expect("connexion postgres");
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("horloge")
        .as_nanos();
    let base = format!("legalos_invitations_{nanos}");
    sqlx::query(&format!("CREATE DATABASE \"{base}\""))
        .execute(&admin)
        .await
        .expect("create database");

    // Le scénario tourne dans sa propre tâche : une assertion qui échoue n'empêche pas la
    // suppression de la base jetable.
    let issue = tokio::spawn(scenario(remplacer_base(&url, &base))).await;
    sqlx::query(&format!("DROP DATABASE \"{base}\" WITH (FORCE)"))
        .execute(&admin)
        .await
        .expect("drop database");
    if let Err(erreur) = issue {
        if erreur.is_panic() {
            std::panic::resume_unwind(erreur.into_panic());
        }
        std::panic::resume_unwind(Box::new(format!("scénario interrompu : {erreur}")));
    }
}

async fn scenario(url_base_jetable: String) {
    let mut config = Config::from_env().expect("configuration");
    config.database_url = url_base_jetable;
    config.run_migrations = false;
    config.messagerie = Some(ParametresMessagerie {
        imap_hote: "127.0.0.1".to_owned(),
        imap_port: 1,
        smtp_hote: "127.0.0.1".to_owned(),
        smtp_port: 1,
        utilisateur: "demo".to_owned(),
        mot_de_passe: "MotDePasseFictif".to_owned(),
        adresse_from: "demo@cabinet.example".to_owned(),
        tls: false,
    });
    let pool = legalos_api::db::connect_pool(&config.database_url)
        .await
        .expect("connexion base jetable");
    legalos_api::db::appliquer_migrations(&pool)
        .await
        .expect("migrations");

    let cabinet = Uuid::parse_str(DEMO_CABINET_ID).expect("cabinet");
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, 'invitations', 'Cabinet fictif', TRUE)")
        .bind(cabinet)
        .execute(&pool)
        .await
        .expect("cabinet");
    let email_a = "titulaire-invitations@cabinet-fictif.example";
    let id_a = Uuid::now_v7();
    creer_utilisateur(&pool, cabinet, id_a, email_a, DEMO_TOTP_SECRET_BASE32).await;
    creer_utilisateur(&pool, cabinet, Uuid::now_v7(), COLLAB_EMAIL, COLLAB_TOTP).await;
    let compte_a = creer_compte(
        &pool,
        cabinet,
        "nominatif",
        Some(id_a),
        "avocat-a@cabinet.example",
    )
    .await;

    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    let app = build_router(state);
    let a = jeton(&app, email_a, DEMO_TOTP_SECRET_BASE32).await;
    let b = jeton(&app, COLLAB_EMAIL, COLLAB_TOTP).await;
    let cadre = Cadre {
        pool: pool.clone(),
        cabinet,
        titulaire: id_a,
        compte: compte_a,
    };

    // =========================================================================================
    // Relève : demande, rejeu, SEQUENCE ancienne, mise à jour, annulation
    // =========================================================================================
    let uid = "inv-j11-principale@example.com";
    let paris = "DTSTART;TZID=Europe/Paris:20261006T090000";
    assert_eq!(
        cadre
            .recevoir(
                &ics("REQUEST", uid, 0, paris, "Audience fictive"),
                "<m0@example.com>"
            )
            .await,
        IssueInvitation::Creee
    );
    let (sequence, effet, debut, debut_utc, revision, reponse) = cadre.ligne(uid).await;
    assert_eq!((sequence, effet.as_str()), (0, "demande"));
    assert_eq!(debut, "2026-10-06T09:00:00");
    assert_eq!(debut_utc.as_deref(), Some("2026-10-06T07:00:00.000Z"));
    assert_eq!(reponse, None);

    // Rejeu du même message : rien ne bouge, pas même la révision (essai négatif plus bas).
    assert_eq!(
        cadre
            .recevoir(
                &ics("REQUEST", uid, 0, paris, "Audience fictive"),
                "<m0@example.com>"
            )
            .await,
        IssueInvitation::Ignoree
    );
    assert_eq!(cadre.ligne(uid).await.4, revision, "rejeu idempotent");
    let total: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM invitations_agenda WHERE uid_ical = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(total, 1, "une seule ligne par (titulaire, UID)");

    // Liste : A la voit, B jamais.
    let (statut, liste_a) = appel(&app, "GET", "/messagerie/invitations", &a, Value::Null).await;
    assert_eq!(statut, StatusCode::OK, "{liste_a}");
    assert_eq!(liste_a.as_array().unwrap().len(), 1);
    assert_eq!(liste_a[0]["uid_ical"], json!(uid));
    assert_eq!(liste_a[0]["debut_utc"], json!("2026-10-06T07:00:00.000Z"));
    assert_eq!(liste_a[0]["message_id"], json!("<m0@example.com>"));
    let (statut, liste_b) = appel(&app, "GET", "/messagerie/invitations", &b, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(liste_b, json!([]), "B ne voit pas l'invitation de A");
    let id_invitation = Uuid::parse_str(liste_a[0]["id"].as_str().unwrap()).unwrap();

    // Réponses (avant la mise à jour : elle remettra la réponse à vide).
    let uri_reponse = format!("/messagerie/invitations/{id_invitation}/reponse");
    let (statut, _) = appel(
        &app,
        "POST",
        &uri_reponse,
        &b,
        json!({"reponse": "accepter"}),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "B ne répond pas pour A");
    let (statut, refus) = appel(&app, "POST", &uri_reponse, &a, json!({"reponse": "oui"})).await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "{refus}");
    let envois: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_envoi")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(envois, 0, "une réponse refusée ne crée aucun envoi");

    let (statut, accepte) = appel(
        &app,
        "POST",
        &uri_reponse,
        &a,
        json!({"reponse": "accepter"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{accepte}");
    assert_eq!(accepte["reponse"], json!("accepte"));
    assert_eq!(
        accepte["envoi_etat"],
        json!("en_attente"),
        "ports fermés : reste dans la file"
    );
    let (envoi_1, destinataire, objet, en_reponse_a, auteur): (
        Uuid,
        String,
        String,
        Option<String>,
        Option<Uuid>,
    ) = sqlx::query_as("SELECT id, destinataire, objet, en_reponse_a, auteur_id FROM file_envoi")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        destinataire, ORGANISATEUR,
        "la réponse part à l'organisateur"
    );
    assert_eq!(objet, "Accepté : Audience fictive");
    assert_eq!(
        en_reponse_a.as_deref(),
        Some("<m0@example.com>"),
        "fil de l'invitation"
    );
    assert_eq!(auteur, Some(id_a));
    let (type_mime, ical): (String, String) = sqlx::query_as(
        "SELECT type_mime, convert_from(contenu, 'UTF8') FROM file_envoi_pieces WHERE envoi_id = $1",
    )
    .bind(envoi_1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        type_mime.to_ascii_lowercase().contains("method=reply"),
        "{type_mime}"
    );
    assert!(ical.contains("METHOD:REPLY"), "{ical}");
    assert!(ical.contains("PARTSTAT=ACCEPTED"), "{ical}");
    assert!(ical.contains(&format!("UID:{uid}")), "{ical}");
    assert!(
        ical.contains("mailto:avocat-a@cabinet.example"),
        "participant : boîte de réception"
    );
    assert!(
        ical.contains("TZID=Europe/Paris"),
        "fuseau conservé : {ical}"
    );

    // La même réponse rejouée : pas de second envoi, même ligne de file.
    let (statut, rejeu) = appel(
        &app,
        "POST",
        &uri_reponse,
        &a,
        json!({"reponse": "accepter"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{rejeu}");
    let envois: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_envoi")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(envois, 1, "même réponse rejouée : aucun second envoi");

    // Une réponse différente remplace la première et renvoie une réponse.
    let (statut, refuse) = appel(
        &app,
        "POST",
        &uri_reponse,
        &a,
        json!({"reponse": "refuser"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{refuse}");
    assert_eq!(refuse["reponse"], json!("refuse"));
    let (statut, provisoire) = appel(
        &app,
        "POST",
        &uri_reponse,
        &a,
        json!({"reponse": "peut_etre"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{provisoire}");
    assert_eq!(provisoire["reponse"], json!("peut_etre"));
    let parties: Vec<String> = sqlx::query_scalar(
        "SELECT convert_from(p.contenu, 'UTF8') FROM file_envoi_pieces p JOIN file_envoi f ON f.id = p.envoi_id ORDER BY f.cree_le, f.id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(parties.len(), 3);
    for (ical, attendu) in parties.iter().zip(["ACCEPTED", "DECLINED", "TENTATIVE"]) {
        assert!(
            ical.contains(&format!("PARTSTAT={attendu}")),
            "{attendu} : {ical}"
        );
    }
    let identifiants: i64 = sqlx::query_scalar("SELECT COUNT(DISTINCT message_id) FROM file_envoi")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(identifiants, 3, "un Message-ID propre à chaque réponse");
    // Essai négatif : repasser à « refuser » après « peut_etre » crée bien un quatrième envoi
    // (le contrôle de rejeu ne se contente pas de compter les appels).
    let (statut, _) = appel(
        &app,
        "POST",
        &uri_reponse,
        &a,
        json!({"reponse": "refuser"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let envois: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_envoi")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(envois, 4);

    // Mise à jour (SEQUENCE 1) : reflétée, réponse remise à vide.
    let nouvelle_heure = "DTSTART;TZID=Europe/Paris:20261006T110000";
    assert_eq!(
        cadre
            .recevoir(
                &ics("REQUEST", uid, 1, nouvelle_heure, "Audience reportee"),
                "<m1@example.com>"
            )
            .await,
        IssueInvitation::MiseAJour
    );
    let (sequence, effet, debut, debut_utc, _, reponse) = cadre.ligne(uid).await;
    assert_eq!((sequence, effet.as_str()), (1, "mise_a_jour"));
    assert_eq!(debut, "2026-10-06T11:00:00");
    assert_eq!(debut_utc.as_deref(), Some("2026-10-06T09:00:00.000Z"));
    assert_eq!(
        reponse, None,
        "une version plus récente demande une nouvelle réponse"
    );
    let objet_lu: String =
        sqlx::query_scalar("SELECT objet FROM invitations_agenda WHERE uid_ical = $1")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(objet_lu, "Audience reportee");

    // SEQUENCE plus ancienne, ou égale : ignorée, la ligne ne bouge pas.
    let avant = cadre.ligne(uid).await;
    assert_eq!(
        cadre
            .recevoir(
                &ics("REQUEST", uid, 0, paris, "Ancienne version"),
                "<ancien@example.com>"
            )
            .await,
        IssueInvitation::Ignoree
    );
    assert_eq!(
        cadre
            .recevoir(
                &ics("REQUEST", uid, 1, paris, "Meme sequence"),
                "<m1bis@example.com>"
            )
            .await,
        IssueInvitation::Ignoree
    );
    assert_eq!(cadre.ligne(uid).await, avant, "la ligne n'a pas bougé");
    // Essai négatif : une SEQUENCE plus récente, elle, est bien appliquée.
    assert_eq!(
        cadre
            .recevoir(
                &ics("REQUEST", uid, 2, paris, "Audience rétablie"),
                "<m2@example.com>"
            )
            .await,
        IssueInvitation::MiseAJour
    );
    assert_eq!(cadre.ligne(uid).await.0, 2);

    // Annulation : la ligne reste, marquée annulée, et ne reçoit plus de réponse.
    assert_eq!(
        cadre
            .recevoir(
                &ics("CANCEL", uid, 3, paris, "Audience rétablie"),
                "<m3@example.com>"
            )
            .await,
        IssueInvitation::Annulee
    );
    let (sequence, effet, ..) = cadre.ligne(uid).await;
    assert_eq!((sequence, effet.as_str()), (3, "annulation"));
    assert_eq!(
        cadre
            .recevoir(
                &ics("CANCEL", uid, 3, paris, "Audience rétablie"),
                "<m3@example.com>"
            )
            .await,
        IssueInvitation::Ignoree,
        "rejeu de l'annulation"
    );
    assert_eq!(
        cadre
            .recevoir(
                &ics("REQUEST", uid, 2, paris, "Trop tard"),
                "<tard@example.com>"
            )
            .await,
        IssueInvitation::Ignoree,
        "une demande plus ancienne ne défait pas l'annulation"
    );
    let envois_avant: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_envoi")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (statut, annulee) = appel(
        &app,
        "POST",
        &uri_reponse,
        &a,
        json!({"reponse": "accepter"}),
    )
    .await;
    assert_eq!(statut, StatusCode::CONFLICT, "{annulee}");
    assert!(
        annulee["message"].as_str().unwrap().contains("annulée"),
        "message en français : {annulee}"
    );
    let envois_apres: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_envoi")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        envois_avant, envois_apres,
        "aucune réponse à une invitation annulée"
    );

    // Annulation d'une invitation jamais reçue : la ligne naît annulée.
    assert_eq!(
        cadre
            .recevoir(
                &ics(
                    "CANCEL",
                    "inv-j11-inconnue@example.com",
                    1,
                    paris,
                    "Jamais vue"
                ),
                "<c@example.com>"
            )
            .await,
        IssueInvitation::Creee
    );
    assert_eq!(
        cadre.ligne("inv-j11-inconnue@example.com").await.1,
        "annulation"
    );

    // Autres méthodes iTIP : ni demande ni annulation, rien n'est enregistré.
    assert_eq!(
        cadre
            .recevoir(
                &ics("REPLY", "inv-j11-reply@example.com", 0, paris, "Reponse"),
                "<r@example.com>"
            )
            .await,
        IssueInvitation::Ignoree
    );
    let reponses: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invitations_agenda WHERE uid_ical = 'inv-j11-reply@example.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reponses, 0);

    // =========================================================================================
    // Fuseaux : Europe/Paris été et hiver, passage à l'heure d'hiver, fuseau étranger, UTC,
    // flottant, journée entière
    // =========================================================================================
    let cas: [(&str, &str, Option<&str>); 9] = [
        (
            "DTSTART;TZID=Europe/Paris:20260708T090000",
            "2026-07-08T09:00:00",
            Some("2026-07-08T07:00:00.000Z"),
        ),
        (
            "DTSTART;TZID=Europe/Paris:20261208T090000",
            "2026-12-08T09:00:00",
            Some("2026-12-08T08:00:00.000Z"),
        ),
        (
            "DTSTART;TZID=Europe/Paris:20261025T013000",
            "2026-10-25T01:30:00",
            Some("2026-10-24T23:30:00.000Z"),
        ),
        (
            "DTSTART;TZID=Europe/Paris:20261025T023000",
            "2026-10-25T02:30:00",
            Some("2026-10-25T00:30:00.000Z"),
        ),
        (
            "DTSTART;TZID=Europe/Paris:20261025T033000",
            "2026-10-25T03:30:00",
            Some("2026-10-25T02:30:00.000Z"),
        ),
        (
            "DTSTART;TZID=America/New_York:20261006T140000",
            "2026-10-06T14:00:00",
            Some("2026-10-06T18:00:00.000Z"),
        ),
        (
            "DTSTART:20261006T070000Z",
            "2026-10-06T07:00:00",
            Some("2026-10-06T07:00:00.000Z"),
        ),
        ("DTSTART:20261006T090000", "2026-10-06T09:00:00", None),
        ("DTSTART;VALUE=DATE:20261006", "2026-10-06", None),
    ];
    for (rang, (ligne_debut, local, utc)) in cas.iter().enumerate() {
        let uid_fuseau = format!("inv-j11-fuseau-{rang}@example.com");
        let message = format!("<fuseau-{rang}@example.com>");
        assert_eq!(
            cadre
                .recevoir(
                    &ics("REQUEST", &uid_fuseau, 0, ligne_debut, "Fuseau"),
                    &message
                )
                .await,
            IssueInvitation::Creee
        );
        let (_, _, debut, debut_utc, _, _) = cadre.ligne(&uid_fuseau).await;
        assert_eq!(&debut, local, "{ligne_debut}");
        assert_eq!(debut_utc.as_deref(), *utc, "{ligne_debut}");
    }
    // Le fuseau annoncé est conservé tel quel, et l'instant UTC ne vient jamais de l'heure du
    // serveur : même heure civile, deux fuseaux, deux instants.
    let fuseaux: Vec<String> = sqlx::query_scalar(
        "SELECT fuseau FROM invitations_agenda WHERE uid_ical LIKE 'inv-j11-fuseau-%' ORDER BY uid_ical",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        fuseaux,
        [
            "Europe/Paris",
            "Europe/Paris",
            "Europe/Paris",
            "Europe/Paris",
            "Europe/Paris",
            "America/New_York",
            "UTC",
            "flottant",
            "flottant"
        ]
    );
    assert_ne!(
        cadre.instants("inv-j11-fuseau-0@example.com").await.0,
        cadre.instants("inv-j11-fuseau-5@example.com").await.0
    );

    // =========================================================================================
    // Un autre collaborateur : rien, ni en lecture ni en réponse
    // =========================================================================================
    let (_, liste_b) = appel(&app, "GET", "/messagerie/invitations", &b, Value::Null).await;
    assert_eq!(liste_b, json!([]), "B ne voit aucune invitation de A");
    let (_, liste_a) = appel(&app, "GET", "/messagerie/invitations", &a, Value::Null).await;
    assert_eq!(liste_a.as_array().unwrap().len(), 11);
    // Essai négatif : l'invitation de A est bien celle qui existe (A obtient autre chose que 404).
    let (statut, _) = appel(
        &app,
        "POST",
        &uri_reponse,
        &a,
        json!({"reponse": "refuser"}),
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::CONFLICT,
        "A atteint sa ligne annulée (409) alors que B a 404"
    );
    // =========================================================================================
    // Origine : seul l'organisateur enregistré met à jour ou annule ; l'ORGANIZER ne change pas
    // =========================================================================================
    let uid_o = "inv-j11-origine@example.com";
    let intrus = "intrus@example.com";
    let secretariat = "secretariat@example.com";
    let ligne_o = || async {
        sqlx::query_as::<_, (i32, String, String, String, bool)>(
            "SELECT sequence, effet, objet, organisateur, verifiee FROM invitations_agenda WHERE titulaire_id = $1 AND uid_ical = $2",
        )
        .bind(id_a)
        .bind(uid_o)
        .fetch_one(&pool)
        .await
        .expect("ligne d'origine")
    };

    // Création par un expéditeur qui n'est pas l'ORGANIZER annoncé : enregistrée, non vérifiée.
    assert_eq!(
        cadre
            .recevoir_de(
                &ics("REQUEST", uid_o, 0, paris, "Audience origine"),
                "<o0@example.com>",
                &[secretariat]
            )
            .await,
        IssueInvitation::Creee
    );
    assert!(!ligne_o().await.4, "création par un tiers : non vérifiée");
    let (statut, liste) = appel(&app, "GET", "/messagerie/invitations", &a, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    let exposee = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["uid_ical"] == json!(uid_o))
        .expect("invitation exposée")
        .clone();
    assert_eq!(exposee["verifiee"], json!(false), "l'API expose le doute");
    // Essai négatif : une création par l'organisateur est vérifiée.
    cadre
        .recevoir(
            &ics(
                "REQUEST",
                "inv-j11-origine-ok@example.com",
                0,
                paris,
                "Audience directe",
            ),
            "<o-ok@example.com>",
        )
        .await;
    let directe: bool = sqlx::query_scalar(
        "SELECT verifiee FROM invitations_agenda WHERE titulaire_id = $1 AND uid_ical = 'inv-j11-origine-ok@example.com'",
    )
    .bind(id_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(directe, "création par l'organisateur : vérifiée");

    // Mise à jour (SEQUENCE supérieure) par un tiers : aucun effet.
    let avant = ligne_o().await;
    let revision_avant: i64 = sqlx::query_scalar(
        "SELECT revision FROM invitations_agenda WHERE titulaire_id = $1 AND uid_ical = $2",
    )
    .bind(id_a)
    .bind(uid_o)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        cadre
            .recevoir_de(
                &ics(
                    "REQUEST",
                    uid_o,
                    4,
                    paris,
                    "Audience deplacee par un intrus"
                ),
                "<o1@example.com>",
                &[intrus]
            )
            .await,
        IssueInvitation::Refusee(VerdictOrigine::ExpediteurTiers)
    );
    // Annulation (SEQUENCE supérieure) par un tiers : aucun effet.
    assert_eq!(
        cadre
            .recevoir_de(
                &ics("CANCEL", uid_o, 5, paris, "Audience origine"),
                "<o2@example.com>",
                &[intrus]
            )
            .await,
        IssueInvitation::Refusee(VerdictOrigine::ExpediteurTiers)
    );
    assert_eq!(
        ligne_o().await,
        avant,
        "ni mise à jour ni annulation par un tiers"
    );
    let revision_apres: i64 = sqlx::query_scalar(
        "SELECT revision FROM invitations_agenda WHERE titulaire_id = $1 AND uid_ical = $2",
    )
    .bind(id_a)
    .bind(uid_o)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(revision_apres, revision_avant, "la révision ne bouge pas");

    // ORGANIZER modifié dans une mise à jour envoyée par l'organisateur enregistré : refusé.
    let organisateur_change = ics("REQUEST", uid_o, 6, paris, "Audience reprise").replace(
        &format!("ORGANIZER:mailto:{ORGANISATEUR}"),
        "ORGANIZER:mailto:autre-organisateur@example.com",
    );
    assert_eq!(
        cadre
            .recevoir_de(&organisateur_change, "<o3@example.com>", &[ORGANISATEUR])
            .await,
        IssueInvitation::Refusee(VerdictOrigine::OrganisateurModifie)
    );
    assert_eq!(
        ligne_o().await,
        avant,
        "l'organisateur enregistré ne change pas"
    );

    // Essais négatifs : les mêmes messages, envoyés par l'organisateur enregistré, s'appliquent.
    assert_eq!(
        cadre
            .recevoir_de(
                &ics("REQUEST", uid_o, 4, paris, "Audience deplacee"),
                "<o4@example.com>",
                &[ORGANISATEUR]
            )
            .await,
        IssueInvitation::MiseAJour
    );
    let apres_maj = ligne_o().await;
    assert_eq!(
        (apres_maj.0, apres_maj.2.as_str()),
        (4, "Audience deplacee")
    );
    assert_eq!(apres_maj.3, ORGANISATEUR);
    assert!(apres_maj.4, "mise à jour de l'organisateur : vérifiée");
    assert_eq!(
        cadre
            .recevoir_de(
                &ics("CANCEL", uid_o, 5, paris, "Audience origine"),
                "<o5@example.com>",
                &[ORGANISATEUR]
            )
            .await,
        IssueInvitation::Annulee
    );
    assert_eq!(ligne_o().await.1, "annulation");
}
