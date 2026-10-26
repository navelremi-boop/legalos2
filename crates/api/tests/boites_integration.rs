//! J11 étape 3 : boîtes nominatives et partagées, droits de lecture, tableau de santé, contre un
//! Postgres réel.
//!
//! Chaque vérification a son essai négatif : la même vérification, appliquée à la situation
//! inverse (autre collaborateur, membre retiré ou ajouté, accès au dossier donné), donne l'inverse.
//! Le flux de synchronisation PowerSync et la relève réelle sont couverts par
//! `tests/recette/j11-boites.mjs`.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::collections::BTreeSet;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use legalos_api::config::{Config, ParametresMessagerie};
use legalos_api::{build_app_state, build_router};
use serde_json::{json, Value};
use totp_rs::{Algorithm, Builder, Secret, Totp};
use tower::ServiceExt;
use uuid::Uuid;

#[path = "support/mod.rs"]
mod support;

use support::demo_seed::{DEMO_CABINET_ID, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32};

const EMAIL_B: &str = "collaborateur-b-boites@cabinet-fictif.example";
const TOTP_B: &str = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
const EMAIL_C: &str = "collaborateur-c-boites@cabinet-fictif.example";
const TOTP_C: &str = "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI";
const CLE: &[u8; 32] = b"legalos_demo_chiffrement_32oct!!";

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
                    json!({"email": email, "password": DEMO_PASSWORD, "nom_appareil": "test-boites"})
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
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref) VALUES ($1, $2, $3, $4, $5, 'test')",
    )
    .bind(id)
    .bind(cabinet)
    .bind(type_compte)
    .bind(titulaire)
    .bind(adresse)
    .execute(pool)
    .await
    .expect("compte");
    id
}

async fn creer_message(
    pool: &sqlx::PgPool,
    cabinet: Uuid,
    compte: Uuid,
    dossier: Option<Uuid>,
    objet: &str,
    uid: i64,
) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO messages (id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
                              objet, expediteur, etat_classement)
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 'tiers@example.com',
                CASE WHEN $4::uuid IS NULL THEN 'a_classer' ELSE 'classe' END)
        "#,
    )
    .bind(id)
    .bind(cabinet)
    .bind(compte)
    .bind(dossier)
    .bind(format!("<boites-{uid}@example.com>"))
    .bind(uid)
    .bind(objet)
    .execute(pool)
    .await
    .expect("message");
    id
}

/// Objets des messages que l'API laisse lire à ce jeton.
async fn objets_lisibles(app: &axum::Router, jeton: &str) -> BTreeSet<String> {
    let (statut, liste) = appel(app, "GET", "/messagerie/messages", jeton, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    liste
        .as_array()
        .expect("liste")
        .iter()
        .map(|m| m["objet"].as_str().expect("objet").to_owned())
        .collect()
}

fn ensemble(objets: &[&str]) -> BTreeSet<String> {
    objets.iter().map(|o| (*o).to_owned()).collect()
}

async fn comptes_visibles(app: &axum::Router, jeton: &str) -> BTreeSet<String> {
    let (statut, liste) = appel(app, "GET", "/messagerie/comptes", jeton, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    liste
        .as_array()
        .expect("liste")
        .iter()
        .map(|c| c["adresse"].as_str().expect("adresse").to_owned())
        .collect()
}

#[tokio::test]
async fn boites_droits_membres_et_sante() {
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
    let base = format!("legalos_boites_{nanos}");
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

#[allow(clippy::too_many_lines)]
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
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, 'boites', 'Cabinet fictif', TRUE)")
        .bind(cabinet)
        .execute(&pool)
        .await
        .expect("cabinet");
    let email_a = "titulaire-a-boites@cabinet-fictif.example";
    let (id_a, id_b, id_c) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    creer_utilisateur(&pool, cabinet, id_a, email_a, DEMO_TOTP_SECRET_BASE32).await;
    creer_utilisateur(&pool, cabinet, id_b, EMAIL_B, TOTP_B).await;
    creer_utilisateur(&pool, cabinet, id_c, EMAIL_C, TOTP_C).await;

    let compte_a = creer_compte(
        &pool,
        cabinet,
        "nominatif",
        Some(id_a),
        "avocat-a@cabinet.example",
    )
    .await;
    let compte_b = creer_compte(
        &pool,
        cabinet,
        "nominatif",
        Some(id_b),
        "avocat-b@cabinet.example",
    )
    .await;
    let classement = creer_compte(
        &pool,
        cabinet,
        "classement",
        None,
        "classement@cabinet.example",
    )
    .await;

    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    let app = build_router(state);
    let a = jeton(&app, email_a, DEMO_TOTP_SECRET_BASE32).await;
    let b = jeton(&app, EMAIL_B, TOTP_B).await;
    let c = jeton(&app, EMAIL_C, TOTP_C).await;

    // =========================================================================================
    // Boîte partagée : création (A, avec B pour membre), mot de passe jamais renvoyé
    // =========================================================================================
    let partagee = Uuid::now_v7();
    let (statut, cree) = appel(
        &app,
        "POST",
        "/messagerie/boites-partagees",
        &a,
        json!({
            "id": partagee, "adresse": "secretariat@cabinet.example", "hote": "127.0.0.1",
            "port": 1, "utilisateur": "secretariat", "mot_de_passe": "SentinelleSecretariat",
            "tls": false, "membres": [id_b]
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert!(
        !cree.to_string().contains("SentinelleSecretariat"),
        "mot de passe dans la réponse"
    );
    let attendus: BTreeSet<String> = [id_a, id_b].iter().map(ToString::to_string).collect();
    let recus: BTreeSet<String> = cree["membres"]
        .as_array()
        .expect("membres")
        .iter()
        .map(|m| m.as_str().expect("id").to_owned())
        .collect();
    assert_eq!(recus, attendus, "le créateur est membre, B aussi");
    let stocke: String =
        sqlx::query_scalar("SELECT secret_chiffre FROM comptes_mail WHERE id = $1")
            .bind(partagee)
            .fetch_one(&pool)
            .await
            .expect("secret");
    assert!(!stocke.contains("SentinelleSecretariat"), "secret en clair");
    // Essai négatif : un membre inconnu du cabinet est refusé, et rien n'est créé.
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/boites-partagees",
        &a,
        json!({
            "id": Uuid::now_v7(), "adresse": "fantome@cabinet.example", "hote": "127.0.0.1",
            "port": 1, "utilisateur": "f", "mot_de_passe": "x", "membres": [Uuid::now_v7()]
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    let fantomes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM comptes_mail WHERE adresse = 'fantome@cabinet.example'",
    )
    .fetch_one(&pool)
    .await
    .expect("comptage");
    assert_eq!(fantomes, 0);

    // =========================================================================================
    // Messages : une boîte nominative par collaborateur, la partagée, la boîte de classement
    // =========================================================================================
    let msg_a = creer_message(&pool, cabinet, compte_a, None, "Mail nominatif de A", 1).await;
    let msg_b = creer_message(&pool, cabinet, compte_b, None, "Mail nominatif de B", 2).await;
    let msg_p = creer_message(
        &pool,
        cabinet,
        partagee,
        None,
        "Mail de la boite partagee",
        3,
    )
    .await;
    let _msg_c = creer_message(&pool, cabinet, classement, None, "Mail du cabinet", 4).await;

    let indicateurs: Vec<(Uuid, bool, bool, i64)> = sqlx::query_as(
        "SELECT id, boite_partagee, arrivee_notifiable, arrivee_seq FROM messages ORDER BY arrivee_seq",
    )
    .fetch_all(&pool)
    .await
    .expect("indicateurs");
    assert_eq!(indicateurs.len(), 4);
    assert!(
        indicateurs.windows(2).all(|w| w[0].3 < w[1].3),
        "arrivee_seq croît strictement"
    );
    for (id, partage, notifiable, _) in &indicateurs {
        assert_eq!(*partage, *id == msg_p, "boite_partagee posé par la base");
        assert!(!notifiable, "pas notifiable par défaut");
    }

    // --- API : liste des messages ----------------------------------------------------------
    let vu_a = objets_lisibles(&app, &a).await;
    let vu_b = objets_lisibles(&app, &b).await;
    let vu_c = objets_lisibles(&app, &c).await;
    assert_eq!(
        vu_a,
        ensemble(&[
            "Mail nominatif de A",
            "Mail de la boite partagee",
            "Mail du cabinet"
        ]),
        "A : sa boîte, la partagée, le cabinet"
    );
    assert_eq!(
        vu_b,
        ensemble(&[
            "Mail nominatif de B",
            "Mail de la boite partagee",
            "Mail du cabinet"
        ]),
        "B : sa boîte, la partagée, le cabinet"
    );
    assert_eq!(
        vu_c,
        ensemble(&["Mail du cabinet"]),
        "C : ni nominatif, ni partagée"
    );
    // Essais négatifs : la même vérification sur la situation inverse donne l'inverse.
    assert!(!vu_b.contains("Mail nominatif de A"), "B lit la boîte de A");
    assert!(!vu_a.contains("Mail nominatif de B"), "A lit la boîte de B");
    assert!(vu_b.contains("Mail de la boite partagee"), "membre B");
    assert!(
        !vu_c.contains("Mail de la boite partagee"),
        "C non membre lit la partagée"
    );

    // --- API : corps du message (404 pour qui n'a pas le droit, jamais 403) ----------------
    // Les comptes de test n'ont pas de serveur IMAP joignable : qui a le droit obtient une erreur
    // de lecture (400 sans mot de passe, 500 serveur injoignable), jamais 404.
    let corps = |id: Uuid| format!("/messagerie/messages/{id}/corps");
    for (jeton_ok, jeton_ko, message, libelle) in [
        (&a, &b, msg_a, "nominatif de A"),
        (&b, &a, msg_b, "nominatif de B"),
        (&b, &c, msg_p, "partagée"),
    ] {
        let (ko, _) = appel(&app, "POST", &corps(message), jeton_ko, Value::Null).await;
        assert_eq!(ko, StatusCode::NOT_FOUND, "{libelle} : intrus");
        let (ok, _) = appel(&app, "POST", &corps(message), jeton_ok, Value::Null).await;
        assert_ne!(ok, StatusCode::NOT_FOUND, "{libelle} : ayant droit");
    }
    let (statut, _) = appel(&app, "POST", &corps(msg_a), &c, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "C ne lit pas la boîte de A");

    // --- Classement d'un message de la partagée : membre oui, non-membre non ---------------
    let dossier = Uuid::now_v7();
    let (statut, _) = appel(
        &app,
        "POST",
        "/dossiers",
        &a,
        json!({
            "id": dossier, "idempotence_cle": format!("boites-{dossier}"),
            "nom": "Dossier public fictif", "chemise": "gris-perle",
            "juridiction": "TJ Paris", "numero_rg": "26/30001", "restreint": false
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let classer = |id: Uuid| format!("/messagerie/messages/{id}/classer");
    let (statut, _) = appel(
        &app,
        "POST",
        &classer(msg_p),
        &c,
        json!({"dossier_id": dossier}),
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::NOT_FOUND,
        "C classe un mail de la partagée"
    );
    let (statut, _) = appel(
        &app,
        "POST",
        &classer(msg_a),
        &b,
        json!({"dossier_id": dossier}),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "B classe un mail de A");
    let (statut, classe) = appel(
        &app,
        "POST",
        &classer(msg_p),
        &b,
        json!({"dossier_id": dossier}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "B, membre, classe");
    assert_eq!(classe["etat_classement"], json!("classe"));

    // =========================================================================================
    // Dossier restreint : un mail de la partagée classé dedans reste fermé au membre sans accès
    // =========================================================================================
    let restreint = Uuid::now_v7();
    let (statut, _) = appel(
        &app,
        "POST",
        "/dossiers",
        &a,
        json!({
            "id": restreint, "idempotence_cle": format!("boites-{restreint}"),
            "nom": "Dossier restreint fictif", "chemise": "gris-perle",
            "juridiction": "TJ Paris", "numero_rg": "26/30002", "restreint": true
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    creer_message(
        &pool,
        cabinet,
        partagee,
        Some(restreint),
        "Mail partage en dossier restreint",
        5,
    )
    .await;
    let restreint_a = objets_lisibles(&app, &a).await;
    let restreint_b = objets_lisibles(&app, &b).await;
    assert!(
        restreint_a.contains("Mail partage en dossier restreint"),
        "A (membre, accès au dossier)"
    );
    assert!(
        !restreint_b.contains("Mail partage en dossier restreint"),
        "B (membre, sans accès au dossier) lit un dossier restreint"
    );
    sqlx::query(
        "INSERT INTO dossier_acces (dossier_id, utilisateur_id, dossier_texte, utilisateur_texte) VALUES ($1, $2, $3, $4)",
    )
    .bind(restreint)
    .bind(id_b)
    .bind(restreint.to_string())
    .bind(id_b.to_string())
    .execute(&pool)
    .await
    .expect("accès");
    assert!(
        objets_lisibles(&app, &b)
            .await
            .contains("Mail partage en dossier restreint"),
        "l'accès au dossier ouvre le mail (la fermeture venait bien du dossier)"
    );

    // =========================================================================================
    // Comptes visibles
    // =========================================================================================
    assert_eq!(
        comptes_visibles(&app, &a).await,
        ensemble(&[
            "avocat-a@cabinet.example",
            "secretariat@cabinet.example",
            "classement@cabinet.example"
        ])
    );
    assert_eq!(
        comptes_visibles(&app, &b).await,
        ensemble(&[
            "avocat-b@cabinet.example",
            "secretariat@cabinet.example",
            "classement@cabinet.example"
        ])
    );
    assert_eq!(
        comptes_visibles(&app, &c).await,
        ensemble(&["classement@cabinet.example"])
    );

    // =========================================================================================
    // Membres : seuls les membres lisent et modifient la liste ; bascule B -> C
    // =========================================================================================
    let uri_membres = format!("/messagerie/boites-partagees/{partagee}/membres");
    let (statut, _) = appel(&app, "GET", &uri_membres, &c, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "C lit les membres");
    let (statut, _) = appel(&app, "PUT", &uri_membres, &c, json!({"membres": [id_c]})).await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "C se déclare membre");
    let (statut, liste) = appel(&app, "GET", &uri_membres, &b, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(liste.as_array().expect("membres").len(), 2);
    let (statut, _) = appel(&app, "PUT", &uri_membres, &a, json!({"membres": []})).await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "boîte sans membre");
    let (statut, _) = appel(
        &app,
        "PUT",
        &uri_membres,
        &a,
        json!({"membres": [id_a, Uuid::now_v7()]}),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "membre inconnu");
    let (statut, _) = appel(
        &app,
        "PUT",
        &uri_membres,
        &a,
        json!({"membres": [id_a, id_c]}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert!(
        objets_lisibles(&app, &c)
            .await
            .contains("Mail de la boite partagee"),
        "C, ajouté, lit la partagée"
    );
    assert!(
        !objets_lisibles(&app, &b)
            .await
            .contains("Mail de la boite partagee"),
        "B, retiré, lit encore la partagée"
    );
    assert!(
        !comptes_visibles(&app, &b)
            .await
            .contains("secretariat@cabinet.example"),
        "B retiré voit encore le compte"
    );
    let (statut, _) = appel(&app, "POST", &corps(msg_p), &b, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "B retiré lit le corps");
    let (statut, _) = appel(&app, "POST", &corps(msg_p), &c, Value::Null).await;
    assert_ne!(statut, StatusCode::NOT_FOUND, "C ajouté lit le corps");

    // =========================================================================================
    // Tableau de santé : relève, refus d'authentification, retard, envoi en échec
    // =========================================================================================
    let sante = |jeton: String| {
        let app = app.clone();
        async move {
            let (statut, corps) =
                appel(&app, "GET", "/messagerie/sante", &jeton, Value::Null).await;
            assert_eq!(statut, StatusCode::OK);
            corps
        }
    };
    let ligne = |sante: &Value, compte: Uuid| -> Value {
        sante["comptes"]
            .as_array()
            .expect("comptes")
            .iter()
            .find(|l| l["compte_id"] == json!(compte))
            .cloned()
            .unwrap_or(Value::Null)
    };
    // État initial : rien relevé, aucun refus, aucun échec.
    let initial = sante(a.clone()).await;
    assert_eq!(initial["alerte"], json!(false));
    assert_eq!(ligne(&initial, compte_a)["derniere_releve_le"], Value::Null);
    // La santé ne montre que les comptes lisibles : A ne voit pas la boîte de B.
    assert_eq!(ligne(&initial, compte_b), Value::Null);
    assert_ne!(ligne(&initial, compte_a), Value::Null);

    // Une relève réussie est notée par le moteur.
    sqlx::query("INSERT INTO moteur_connexions (compte_id, issue) VALUES ($1, 'ok')")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("relève notée");
    sqlx::query("UPDATE comptes_mail SET etat_connexion = 'connecte' WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("état");
    let apres_releve = sante(a.clone()).await;
    let l = ligne(&apres_releve, compte_a);
    assert!(
        l["derniere_releve_le"].is_string(),
        "dernière relève absente"
    );
    assert_eq!(l["alerte"], json!(false), "compte sain en alerte");
    assert_eq!(l["erreurs_authentification"], json!(0));
    assert!(l["retard_secondes"].as_i64().expect("retard") < 60);

    // Indexation de fond (D6) : le tableau de santé compte les messages « à venir » comme l'indexation elle-même. Ceux
    // d'une UIDVALIDITY périmée attendent leur resynchronisation et ne sont pas comptés (sinon la progression ne finit
    // jamais) ; essai négatif : une fois le curseur à la génération des messages, ils sont de nouveau « à venir ».
    let restants = |sante: Value| -> i64 {
        ligne(&sante, compte_a)["corps_restants"]
            .as_i64()
            .expect("corps_restants")
    };
    let a_venir = restants(sante(a.clone()).await);
    assert!(a_venir > 0, "des messages sont à venir sans curseur");
    sqlx::query("INSERT INTO releve_curseurs (compte_id, dossier_imap, uid_validity, dernier_uid) VALUES ($1, 'INBOX', 2, 100) ON CONFLICT (compte_id, dossier_imap) DO UPDATE SET uid_validity = 2")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("curseur d'une autre génération");
    assert_eq!(
        restants(sante(a.clone()).await),
        0,
        "les messages d'une UIDVALIDITY périmée ne sont pas « à venir »"
    );
    sqlx::query("UPDATE releve_curseurs SET uid_validity = 1 WHERE compte_id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("curseur à la génération des messages");
    assert_eq!(restants(sante(a.clone()).await), a_venir);

    // Refus d'authentification : alerte, compte et motif.
    sqlx::query("INSERT INTO moteur_connexions (compte_id, issue) VALUES ($1, 'authentification')")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("refus noté");
    sqlx::query("UPDATE comptes_mail SET etat_connexion = 'identifiants_refuses' WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("état");
    let apres_refus = sante(a.clone()).await;
    let l = ligne(&apres_refus, compte_a);
    assert_eq!(l["alerte"], json!(true));
    assert_eq!(l["motifs"], json!(["identifiants_refuses"]));
    assert_eq!(l["erreurs_authentification"], json!(1));
    assert!(l["derniere_erreur_authentification_le"].is_string());
    assert_eq!(apres_refus["alerte"], json!(true));
    // Essai négatif : B n'a ni le compte ni l'alerte de A.
    let sante_b = sante(b.clone()).await;
    assert_eq!(ligne(&sante_b, compte_a), Value::Null);
    assert_eq!(
        sante_b["alerte"],
        json!(false),
        "l'alerte de A est celle de B"
    );

    // Serveur indisponible (consigne du 26/10/2026) : état et motif à part, jamais « identifiants refusés » ; un refus
    // d'identifiants reste dit tel quel même si l'indicateur est posé.
    sqlx::query("UPDATE comptes_mail SET serveur_indisponible = TRUE WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("indicateur");
    let l = ligne(&sante(a.clone()).await, compte_a).clone();
    assert_eq!(l["etat_connexion"], json!("identifiants_refuses"));
    assert_eq!(l["motifs"], json!(["identifiants_refuses"]));
    sqlx::query("UPDATE comptes_mail SET etat_connexion = 'connecte' WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("état connecté");
    let l = ligne(&sante(a.clone()).await, compte_a).clone();
    assert_eq!(l["etat_connexion"], json!("indisponible"));
    assert_eq!(l["motifs"], json!(["serveur_indisponible"]));
    assert_eq!(l["alerte"], json!(true));
    sqlx::query("UPDATE comptes_mail SET serveur_indisponible = FALSE WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("indicateur retiré");
    let l = ligne(&sante(a.clone()).await, compte_a).clone();
    assert_eq!(l["etat_connexion"], json!("connecte"));
    sqlx::query("UPDATE comptes_mail SET etat_connexion = 'identifiants_refuses' WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("état refusé rétabli");

    // Retard : dernière relève trop ancienne (partagée), puis récente.
    sqlx::query("INSERT INTO moteur_connexions (compte_id, issue, cree_le) VALUES ($1, 'ok', NOW() - INTERVAL '40 minutes')")
        .bind(partagee)
        .execute(&pool)
        .await
        .expect("relève ancienne");
    let en_retard = ligne(&sante(a.clone()).await, partagee);
    assert_eq!(en_retard["motifs"], json!(["retard"]));
    assert!(en_retard["retard_secondes"].as_i64().expect("retard") > 2000);
    sqlx::query("INSERT INTO moteur_connexions (compte_id, issue) VALUES ($1, 'ok')")
        .bind(partagee)
        .execute(&pool)
        .await
        .expect("relève récente");
    let a_jour = ligne(&sante(a.clone()).await, partagee);
    assert_eq!(
        a_jour["motifs"],
        json!([]),
        "relève récente : plus de retard"
    );
    assert_eq!(a_jour["alerte"], json!(false));

    // Envoi en échec de A : visible de A (compte de classement et total), pas de B.
    sqlx::query(
        r#"
        INSERT INTO file_envoi (id, cabinet_id, compte_id, message_id, destinataire, objet, etat, auteur_id)
        VALUES ($1, $2, $3, '<boites-echec@example.com>', 'tiers@example.com', 'Envoi fictif', 'echec', $4)
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(classement)
    .bind(id_a)
    .execute(&pool)
    .await
    .expect("envoi en échec");
    let avec_echec = sante(a.clone()).await;
    assert_eq!(avec_echec["envois_en_echec"], json!(1));
    let l = ligne(&avec_echec, classement);
    assert_eq!(l["envois_en_echec"], json!(1));
    assert_eq!(l["motifs"], json!(["envoi_en_echec"]));
    let sante_b = sante(b.clone()).await;
    assert_eq!(
        sante_b["envois_en_echec"],
        json!(0),
        "l'échec de A est celui de B"
    );
    assert_eq!(ligne(&sante_b, classement)["envois_en_echec"], json!(0));
    // Plus aucun échec : l'alerte tombe (essai négatif de la précédente).
    sqlx::query("UPDATE file_envoi SET etat = 'copie_envoyes_confirmee'")
        .execute(&pool)
        .await
        .expect("envoi confirmé");
    assert_eq!(sante(a.clone()).await["envois_en_echec"], json!(0));

    // =========================================================================================
    // (v) Connexion d'une boîte : seul le titulaire reconnecte sa boîte nominative
    // =========================================================================================
    let uri_a = format!("/messagerie/comptes/{compte_a}/connexion");
    let valide = json!({
        "hote": "imap.cabinet.example",
        "port": 993,
        "utilisateur": "avocat-a",
        "mot_de_passe": "MotDePasseNeuf-1!",
        "tls": true,
        "smtp_hote": "smtp.cabinet.example",
        "smtp_port": 587,
        "smtp_utilisateur": "avocat-a",
        "smtp_mot_de_passe": "SmtpNeuf-1!",
        "repondre_a": "greffe@cabinet.example"
    });
    // Un compte refusé repart de « inconnu » avec de nouveaux identifiants, et le moteur n'a plus d'empreinte de refus.
    sqlx::query("UPDATE comptes_mail SET etat_connexion = 'identifiants_refuses', empreinte_refus = 'ancienne' WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("refus simulé");
    let (statut, reponse) = appel(&app, "PUT", &uri_a, &a, valide.clone()).await;
    assert_eq!(statut, StatusCode::OK, "{reponse}");
    assert_eq!(reponse["adresse"], json!("avocat-a@cabinet.example"));
    let apres: (String, Option<String>, String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT etat_connexion, empreinte_refus, hote, smtp_hote, repondre_a FROM comptes_mail WHERE id = $1",
    )
    .bind(compte_a)
    .fetch_one(&pool)
    .await
    .expect("compte mis à jour");
    assert_eq!(apres.0, "inconnu", "la reconnexion repart de « inconnu »");
    assert_eq!(
        apres.1, None,
        "plus d'empreinte de refus : le moteur réessaie"
    );
    assert_eq!(apres.2, "imap.cabinet.example");
    assert_eq!(apres.3.as_deref(), Some("smtp.cabinet.example"));
    assert_eq!(apres.4.as_deref(), Some("greffe@cabinet.example"));
    // Les secrets sont chiffrés en base, jamais en clair ni dans la réponse.
    let secrets: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT secret_chiffre, smtp_secret_chiffre FROM comptes_mail WHERE id = $1",
    )
    .bind(compte_a)
    .fetch_one(&pool)
    .await
    .expect("secrets");
    assert!(secrets
        .0
        .as_deref()
        .is_some_and(|s| !s.contains("MotDePasseNeuf")));
    assert!(secrets
        .1
        .as_deref()
        .is_some_and(|s| !s.contains("SmtpNeuf")));
    assert!(!reponse.to_string().contains("MotDePasseNeuf"));

    // Essais négatifs : le compte d'un confrère, la boîte partagée et celle du cabinet sont introuvables (404), sans rien changer.
    for (compte, nom) in [
        (compte_b, "boîte nominative d'un confrère"),
        (partagee, "boîte partagée"),
        (classement, "boîte du cabinet"),
    ] {
        let avant: (String,) = sqlx::query_as("SELECT hote FROM comptes_mail WHERE id = $1")
            .bind(compte)
            .fetch_one(&pool)
            .await
            .map(|(h,): (Option<String>,)| (h.unwrap_or_default(),))
            .expect("hôte avant");
        let (statut, _) = appel(
            &app,
            "PUT",
            &format!("/messagerie/comptes/{compte}/connexion"),
            &a,
            valide.clone(),
        )
        .await;
        assert_eq!(statut, StatusCode::NOT_FOUND, "{nom}");
        let apres_refus: (Option<String>,) =
            sqlx::query_as("SELECT hote FROM comptes_mail WHERE id = $1")
                .bind(compte)
                .fetch_one(&pool)
                .await
                .expect("hôte après");
        assert_eq!(
            apres_refus.0.unwrap_or_default(),
            avant.0,
            "{nom} : rien n'a changé"
        );
    }
    // Sans jeton : 401. Compte inconnu : 404.
    let (statut, _) = appel(&app, "PUT", &uri_a, "", valide.clone()).await;
    assert_eq!(statut, StatusCode::UNAUTHORIZED);
    let (statut, _) = appel(
        &app,
        "PUT",
        &format!("/messagerie/comptes/{}/connexion", Uuid::now_v7()),
        &a,
        valide.clone(),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    // Saisies refusées avant tout effet.
    for (champ, valeur, motif) in [
        ("hote", json!("imap exemple"), "espace dans le serveur"),
        (
            "hote",
            json!("imap.exemple\r\nX: y"),
            "retour à la ligne dans le serveur",
        ),
        ("hote", json!(""), "serveur vide"),
        ("port", json!(0), "port zéro"),
        ("utilisateur", json!(""), "identifiant vide"),
        ("mot_de_passe", json!(""), "mot de passe vide"),
        (
            "smtp_hote",
            json!(null),
            "SMTP incomplet (port sans serveur)",
        ),
        (
            "repondre_a",
            json!("a@exemple.example\r\nBcc: b@exemple.example"),
            "Reply-To injectable",
        ),
    ] {
        let mut corps_invalide = valide.clone();
        corps_invalide[champ] = valeur;
        let (statut, _) = appel(&app, "PUT", &uri_a, &a, corps_invalide).await;
        assert_eq!(statut, StatusCode::BAD_REQUEST, "{motif}");
    }
    let hote_final: (Option<String>,) =
        sqlx::query_as("SELECT hote FROM comptes_mail WHERE id = $1")
            .bind(compte_a)
            .fetch_one(&pool)
            .await
            .expect("hôte final");
    assert_eq!(
        hote_final.0.as_deref(),
        Some("imap.cabinet.example"),
        "les saisies refusées n'ont rien changé"
    );
    // Une boîte OAuth se reconnecte par son fournisseur, pas par un mot de passe.
    sqlx::query("UPDATE comptes_mail SET secret_ref = 'oauth' WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("compte oauth");
    let (statut, reponse) = appel(&app, "PUT", &uri_a, &a, valide.clone()).await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "{reponse}");
    sqlx::query("UPDATE comptes_mail SET secret_ref = 'chiffre' WHERE id = $1")
        .bind(compte_a)
        .execute(&pool)
        .await
        .expect("compte rétabli");
}
