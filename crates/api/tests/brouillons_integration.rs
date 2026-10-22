//! J11 étape 1b : brouillons, pièces, envoi du brouillon et complétion des destinataires, contre
//! un Postgres réel, sans serveur IMAP ni SMTP joignable (le port de la boîte est fermé : la
//! copie IMAP reste en erreur, ce qui exerce aussi la reprise).
//!
//! Une base jetable est créée puis supprimée. La copie dans le dossier Brouillons d'un vrai
//! serveur IMAP, l'envoi réel et le flux PowerSync sont couverts par
//! `tests/recette/j11-redaction-api.mjs` et `tests/recette/s5-sync-streams.mjs`.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::{Duration, SystemTime, UNIX_EPOCH};

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

const COLLAB_EMAIL: &str = "collaborateur-brouillons@cabinet-fictif.example";
const COLLAB_TOTP: &str = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
const CLE: &[u8; 32] = b"legalos_demo_chiffrement_32oct!!";
const MIO: usize = 1024 * 1024;

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

/// Corps brut (pièce jointe), type de contenu facultatif.
async fn appel_brut(
    app: &axum::Router,
    uri: &str,
    jeton: &str,
    type_contenu: Option<&str>,
    octets: Vec<u8>,
) -> (StatusCode, Value) {
    let mut requete = Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", format!("Bearer {jeton}"));
    if let Some(type_contenu) = type_contenu {
        requete = requete.header("content-type", type_contenu);
    }
    let reponse = app
        .clone()
        .oneshot(requete.body(Body::from(octets)).unwrap())
        .await
        .unwrap();
    let statut = reponse.status();
    (statut, corps(reponse).await)
}

async fn jeton(app: &axum::Router, email: &str, mot_de_passe: &str, totp: &str) -> String {
    let connexion = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/connexion")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email": email, "password": mot_de_passe, "nom_appareil": "test-brouillons"})
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

async fn creer_utilisateur(
    pool: &sqlx::PgPool,
    cabinet: Uuid,
    id: Uuid,
    email: &str,
    mot_de_passe: &str,
    totp: &str,
) {
    let hash = legalos_api::auth::password::hash_password(mot_de_passe).expect("hash");
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

async fn compter(pool: &sqlx::PgPool, requete: &str, id: Uuid) -> i64 {
    sqlx::query_scalar::<_, i64>(requete)
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("comptage")
}

#[tokio::test]
async fn brouillons_pieces_envoi_et_completion() {
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
    let base = format!("legalos_brouillons_{nanos}");
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
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, 'brouillons', 'Cabinet fictif', TRUE)")
        .bind(cabinet)
        .execute(&pool)
        .await
        .expect("cabinet");
    let email_a = "titulaire-brouillons@cabinet-fictif.example";
    let id_a = Uuid::now_v7();
    creer_utilisateur(
        &pool,
        cabinet,
        id_a,
        email_a,
        DEMO_PASSWORD,
        DEMO_TOTP_SECRET_BASE32,
    )
    .await;
    creer_utilisateur(
        &pool,
        cabinet,
        Uuid::now_v7(),
        COLLAB_EMAIL,
        DEMO_PASSWORD,
        COLLAB_TOTP,
    )
    .await;

    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    let app = build_router(state);
    let a = jeton(&app, email_a, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32).await;
    let b = jeton(&app, COLLAB_EMAIL, DEMO_PASSWORD, COLLAB_TOTP).await;

    // =========================================================================================
    // Création, écriture partielle, rejeu idempotent
    // =========================================================================================
    let x = Uuid::now_v7();
    let uri = format!("/messagerie/brouillons/{x}");
    let (statut, cree) = appel(&app, "PUT", &uri, &a, json!({})).await;
    assert_eq!(statut, StatusCode::OK, "{cree}");
    assert_eq!(cree["revision"], json!(1));
    assert_eq!(cree["genre"], json!("nouveau"));
    assert_eq!(cree["pieces"], json!([]));
    let message_id = cree["message_id"].as_str().expect("message_id").to_owned();
    assert!(message_id.starts_with("<envoi-") && message_id.ends_with("@cabinet.example>"));

    let ecriture = json!({
        "a": ["Confrère Fictif <confrere@example.com>"],
        "cc": ["copie@example.com"],
        "cci": ["cachee@example.com"],
        "objet": "Audience du 12",
        "corps_html": "<p>Bonjour maître.</p><script>alert(1)</script>",
    });
    let (statut, ecrit) = appel(&app, "PUT", &uri, &a, ecriture.clone()).await;
    assert_eq!(statut, StatusCode::OK, "{ecrit}");
    assert_eq!(ecrit["revision"], json!(2));
    assert_eq!(ecrit["message_id"], json!(message_id), "Message-ID figé");
    assert_eq!(ecrit["corps"], json!("Bonjour maître."));
    assert!(!ecrit["corps_html"].as_str().unwrap().contains("script"));
    assert_eq!(ecrit["cci"], json!(["cachee@example.com"]));
    // Rejeu à l'identique : rien n'est réécrit, la révision ne bouge pas.
    let (_, rejeu) = appel(&app, "PUT", &uri, &a, ecriture).await;
    assert_eq!(rejeu["revision"], json!(2), "rejeu idempotent");
    // Essai négatif : un contenu différent fait bien avancer la révision.
    let (_, change) = appel(&app, "PUT", &uri, &a, json!({"objet": "Audience du 13"})).await;
    assert_eq!(change["revision"], json!(3));
    assert_eq!(change["objet"], json!("Audience du 13"));
    assert_eq!(
        change["a"],
        json!(["Confrère Fictif <confrere@example.com>"]),
        "écriture partielle : les autres champs restent"
    );
    // Dernière écriture gagnante : pas de contrôle de révision, une valeur ancienne est acceptée.
    let (statut, _) = appel(
        &app,
        "PUT",
        &uri,
        &a,
        json!({"objet": "Audience du 11", "revision": 1, "base_revision": 1}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);

    // Champs figés : redonnés à l'identique ils passent, modifiés ils sont refusés.
    for (nom, requete) in [
        (
            "Message-ID",
            json!({"message_id": "<autre@cabinet.example>"}),
        ),
        ("genre", json!({"genre": "transfert"})),
        ("origine", json!({"origine_message_id": Uuid::now_v7()})),
        ("compte", json!({"compte_id": Uuid::now_v7()})),
    ] {
        let (statut, _) = appel(&app, "PUT", &uri, &a, requete).await;
        assert_eq!(statut, StatusCode::BAD_REQUEST, "champ figé : {nom}");
    }
    let (statut, _) = appel(
        &app,
        "PUT",
        &uri,
        &a,
        json!({"message_id": message_id, "genre": "nouveau"}),
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::OK,
        "champs figés redonnés à l'identique"
    );

    // En-têtes non injectables : refus, aucune écriture.
    let (_, avant) = appel(&app, "GET", &uri, &a, Value::Null).await;
    for (nom, requete) in [
        ("objet", json!({"objet": "Note\r\nBcc: pirate@example.com"})),
        (
            "adresse à",
            json!({"a": ["x@example.com\nBcc: pirate@example.com"]}),
        ),
        (
            "adresse cc",
            json!({"cc": ["x@example.com\r\nX-Injecte: oui"]}),
        ),
        (
            "adresse cci",
            json!({"cci": ["x@example.com\r\nX-Injecte: oui"]}),
        ),
        (
            "In-Reply-To",
            json!({"en_reponse_a": "<x@example.com>\r\nBcc: p@example.com"}),
        ),
        (
            "références",
            json!({"references": ["<x@example.com>\nBcc: p@example.com"]}),
        ),
        ("genre inconnu", json!({"genre": "repondre"})),
    ] {
        let (statut, _) = appel(&app, "PUT", &uri, &a, requete).await;
        assert_eq!(statut, StatusCode::BAD_REQUEST, "injection : {nom}");
    }
    let (_, apres) = appel(&app, "GET", &uri, &a, Value::Null).await;
    assert_eq!(avant, apres, "un refus n'écrit rien");
    // Dossier introuvable : refusé ; détacher (null) accepté.
    let (statut, _) = appel(&app, "PUT", &uri, &a, json!({"dossier_id": Uuid::now_v7()})).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    let (statut, _) = appel(&app, "PUT", &uri, &a, json!({"dossier_id": null})).await;
    assert_eq!(statut, StatusCode::OK);
    // Réponse sans message d'origine : refusée à la création.
    let (statut, _) = appel(
        &app,
        "PUT",
        &format!("/messagerie/brouillons/{}", Uuid::now_v7()),
        &a,
        json!({"genre": "reponse"}),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);

    // =========================================================================================
    // Droits : un autre collaborateur ne voit, n'écrit, ne supprime ni n'envoie rien (404)
    // =========================================================================================
    let revision_a = compter(
        &pool,
        "SELECT revision FROM brouillons_message WHERE id = $1",
        x,
    )
    .await;
    let (statut, liste_b) = appel(&app, "GET", "/messagerie/brouillons", &b, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(liste_b, json!([]), "B ne voit aucun brouillon de A");
    let (_, liste_a) = appel(&app, "GET", "/messagerie/brouillons", &a, Value::Null).await;
    assert_eq!(liste_a.as_array().unwrap().len(), 1, "A voit le sien");
    for (methode, chemin, contenu) in [
        ("GET", uri.clone(), Value::Null),
        ("PUT", uri.clone(), json!({"objet": "Intrus"})),
        ("DELETE", uri.clone(), Value::Null),
        ("POST", format!("{uri}/envoyer"), Value::Null),
        (
            "DELETE",
            format!("{uri}/pieces/{}", Uuid::now_v7()),
            Value::Null,
        ),
    ] {
        let (statut, _) = appel(&app, methode, &chemin, &b, contenu).await;
        assert_eq!(statut, StatusCode::NOT_FOUND, "B : {methode} {chemin}");
    }
    let (statut, _) = appel_brut(
        &app,
        &format!("{uri}/pieces?nom=intrus.txt"),
        &b,
        None,
        b"intrus".to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "B ajoute une pièce chez A");
    assert_eq!(
        compter(
            &pool,
            "SELECT revision FROM brouillons_message WHERE id = $1",
            x
        )
        .await,
        revision_a,
        "le brouillon de A n'a pas bougé"
    );
    // Essai négatif : A, lui, accède à son brouillon par les mêmes routes.
    let (statut, _) = appel(&app, "GET", &uri, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    // B ne peut pas non plus prendre l'identifiant de A pour créer le sien.
    let (statut, _) = appel(&app, "PUT", &uri, &b, json!({"objet": "Mien"})).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);

    // =========================================================================================
    // Pièces : limite cumulée, rejeu, type MIME, retrait
    // =========================================================================================
    let uri_pieces = format!("{uri}/pieces");
    let piece_a = Uuid::now_v7();
    let (statut, avec) = appel_brut(
        &app,
        &format!("{uri_pieces}?nom=Convocation.pdf&piece_id={piece_a}"),
        &a,
        None,
        vec![7u8; 1000],
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{avec}");
    assert_eq!(avec["pieces"].as_array().unwrap().len(), 1);
    assert_eq!(
        avec["pieces"][0]["type_mime"],
        json!("application/pdf"),
        "type déduit du nom"
    );
    assert_eq!(avec["pieces"][0]["taille"], json!(1000));
    // Rejeu avec le même identifiant de pièce : pas de doublon.
    let (statut, rejeu) = appel_brut(
        &app,
        &format!("{uri_pieces}?nom=Convocation.pdf&piece_id={piece_a}"),
        &a,
        None,
        vec![7u8; 1000],
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(
        rejeu["pieces"].as_array().unwrap().len(),
        1,
        "rejeu sans doublon"
    );
    // Type annoncé valable : retenu.
    let (_, annonce) = appel_brut(
        &app,
        &format!("{uri_pieces}?nom=note.bin"),
        &a,
        Some("text/plain; charset=utf-8"),
        b"texte".to_vec(),
    )
    .await;
    assert_eq!(annonce["pieces"][1]["type_mime"], json!("text/plain"));
    let piece_note = annonce["pieces"][1]["id"].as_str().unwrap().to_owned();
    // Refus : nom absent, nom avec séparateur, corps vide.
    for (nom, chemin, octets) in [
        ("sans nom", uri_pieces.clone(), b"x".to_vec()),
        (
            "nom avec séparateur",
            format!("{uri_pieces}?nom=..%2Fsecret.txt"),
            b"x".to_vec(),
        ),
        (
            "pièce vide",
            format!("{uri_pieces}?nom=vide.txt"),
            Vec::new(),
        ),
    ] {
        let (statut, _) = appel_brut(&app, &chemin, &a, None, octets).await;
        assert_eq!(statut, StatusCode::BAD_REQUEST, "pièce refusée : {nom}");
    }
    // Limite cumulée de 25 Mio : 1000 + 5 + 23 Mio passent, 2 Mio de plus dépassent.
    let (statut, _) = appel_brut(
        &app,
        &format!("{uri_pieces}?nom=gros.bin"),
        &a,
        None,
        vec![1u8; 23 * MIO],
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "23 Mio sous la limite");
    let (statut, trop) = appel_brut(
        &app,
        &format!("{uri_pieces}?nom=en-trop.bin"),
        &a,
        None,
        vec![2u8; 2 * MIO],
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "{trop}");
    assert!(trop["message"].as_str().unwrap().contains("25 Mio"));
    assert_eq!(
        compter(
            &pool,
            "SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = $1",
            x
        )
        .await,
        3,
        "la pièce refusée n'est pas enregistrée"
    );
    // Au-delà de la limite de corps de la route : 413, rien d'enregistré.
    let (statut, _) = appel_brut(
        &app,
        &format!("{uri_pieces}?nom=enorme.bin"),
        &a,
        None,
        vec![3u8; 25 * MIO + 4096],
    )
    .await;
    assert_eq!(statut, StatusCode::PAYLOAD_TOO_LARGE);
    // Essai négatif : une fois la grosse pièce retirée, les mêmes 2 Mio passent.
    let gros = annonce_pieces(&app, &uri, &a).await;
    let id_gros = gros
        .iter()
        .find(|p| p["nom"] == json!("gros.bin"))
        .expect("grosse pièce")["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (statut, retire) = appel(
        &app,
        "DELETE",
        &format!("{uri_pieces}/{id_gros}"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(retire["pieces"].as_array().unwrap().len(), 2);
    let (statut, _) = appel_brut(
        &app,
        &format!("{uri_pieces}?nom=en-trop.bin"),
        &a,
        None,
        vec![2u8; 2 * MIO],
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::OK,
        "même pièce sous la limite après retrait"
    );
    let piece_en_trop = {
        let pieces = annonce_pieces(&app, &uri, &a).await;
        pieces
            .iter()
            .find(|p| p["nom"] == json!("en-trop.bin"))
            .expect("pièce")["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let (statut, _) = appel(
        &app,
        "DELETE",
        &format!("{uri_pieces}/{piece_en_trop}"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let (statut, _) = appel(
        &app,
        "DELETE",
        &format!("{uri_pieces}/{piece_en_trop}"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::NOT_FOUND,
        "retirer deux fois la même pièce"
    );
    let _ = piece_note;

    // La copie IMAP ne peut pas partir (port fermé) : l'état passe à « erreur », la ligne reste.
    let mut etat = String::new();
    for _ in 0..40 {
        etat = sqlx::query_scalar::<_, String>(
            "SELECT imap_etat FROM brouillons_message WHERE id = $1",
        )
        .bind(x)
        .fetch_one(&pool)
        .await
        .expect("état");
        if etat == "erreur" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert_eq!(
        etat, "erreur",
        "dépôt IMAP impossible : état en erreur, reprise au balayage"
    );
    let (statut, lu) = appel(&app, "GET", &uri, &a, Value::Null).await;
    assert_eq!(
        statut,
        StatusCode::OK,
        "le brouillon reste lisible malgré l'échec IMAP"
    );
    assert_eq!(lu["imap_etat"], json!("erreur"));

    // =========================================================================================
    // Envoi du brouillon
    // =========================================================================================
    // Sans destinataire : refusé, le brouillon reste.
    let vide = Uuid::now_v7();
    let (statut, _) = appel(
        &app,
        "PUT",
        &format!("/messagerie/brouillons/{vide}"),
        &a,
        json!({"objet": "Sans destinataire"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let (statut, _) = appel(
        &app,
        "POST",
        &format!("/messagerie/brouillons/{vide}/envoyer"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "aucun destinataire");
    assert_eq!(
        compter(&pool, "SELECT COUNT(*) FROM file_envoi WHERE id = $1", vide).await,
        0,
        "aucune ligne de file créée"
    );
    // Adresse illisible : refusée avant tout effet.
    let (_, _) = appel(
        &app,
        "PUT",
        &format!("/messagerie/brouillons/{vide}"),
        &a,
        json!({"a": ["jean@"]}),
    )
    .await;
    let (statut, _) = appel(
        &app,
        "POST",
        &format!("/messagerie/brouillons/{vide}/envoyer"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "adresse illisible");
    assert_eq!(
        compter(&pool, "SELECT COUNT(*) FROM file_envoi WHERE id = $1", vide).await,
        0
    );

    let (statut, envoi) = appel(&app, "POST", &format!("{uri}/envoyer"), &a, Value::Null).await;
    assert_eq!(statut, StatusCode::OK, "{envoi}");
    assert_eq!(
        envoi["id"],
        json!(x.to_string()),
        "la file reprend l'identifiant du brouillon"
    );
    assert_eq!(envoi["etat"], json!("brouillon"));
    assert_eq!(envoi["message_id"], json!(message_id));
    assert_eq!(envoi["cci"], json!(["cachee@example.com"]));
    assert_eq!(envoi["objet"], json!("Audience du 11"));
    assert_eq!(
        compter(
            &pool,
            "SELECT COUNT(*) FROM file_envoi_pieces WHERE envoi_id = $1",
            x
        )
        .await,
        2,
        "les deux pièces restantes sont dans la file"
    );
    assert_eq!(
        compter(
            &pool,
            "SELECT COUNT(*) FROM brouillons_message_pieces WHERE brouillon_id = $1",
            x
        )
        .await,
        0,
        "les pièces ne restent pas côté brouillon"
    );
    // Le brouillon n'est plus visible (la copie IMAP, injoignable ici, sera retirée au balayage).
    let (statut, _) = appel(&app, "GET", &uri, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    let (_, liste_a) = appel(&app, "GET", "/messagerie/brouillons", &a, Value::Null).await;
    assert!(liste_a
        .as_array()
        .unwrap()
        .iter()
        .all(|l| l["id"] != json!(x.to_string())));
    let etat_retrait =
        sqlx::query_scalar::<_, String>("SELECT imap_etat FROM brouillons_message WHERE id = $1")
            .bind(x)
            .fetch_optional(&pool)
            .await
            .expect("état");
    assert_eq!(
        etat_retrait.as_deref(),
        Some("a_retirer"),
        "ligne gardée pour finir le retrait IMAP"
    );
    // Rejeu : même ligne de file, aucun doublon, aucune pièce en double.
    let (statut, rejoue) = appel(&app, "POST", &format!("{uri}/envoyer"), &a, Value::Null).await;
    assert_eq!(statut, StatusCode::OK, "{rejoue}");
    assert_eq!(rejoue["id"], envoi["id"]);
    assert_eq!(compter(&pool, "SELECT COUNT(*) FROM file_envoi WHERE message_id IN (SELECT message_id FROM file_envoi WHERE id = $1)", x).await, 1);
    assert_eq!(
        compter(
            &pool,
            "SELECT COUNT(*) FROM file_envoi_pieces WHERE envoi_id = $1",
            x
        )
        .await,
        2,
        "rejeu sans pièces en double"
    );
    // Un autre collaborateur ne rejoue pas l'envoi de A.
    let (statut, _) = appel(&app, "POST", &format!("{uri}/envoyer"), &b, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    // L'identifiant d'un brouillon envoyé ne ressuscite pas par une écriture rejouée.
    let (statut, _) = appel(&app, "PUT", &uri, &a, json!({"objet": "Retour"})).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    // La ligne de file est celle de A.
    let (_, file_a) = appel(&app, "GET", "/messagerie/file-envoi", &a, Value::Null).await;
    assert!(file_a
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["id"] == json!(x.to_string())));
    let (_, file_b) = appel(&app, "GET", "/messagerie/file-envoi", &b, Value::Null).await;
    assert!(file_b
        .as_array()
        .unwrap()
        .iter()
        .all(|l| l["id"] != json!(x.to_string())));

    // =========================================================================================
    // Suppression
    // =========================================================================================
    // Compte sans identifiants lisibles (OAuth) : aucune copie n'a pu être déposée, la ligne
    // disparaît tout de suite.
    let compte_oauth = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref) VALUES ($1, $2, 'nominatif', $3, 'oauth.a@cabinet.example', 'oauth')",
    )
    .bind(compte_oauth)
    .bind(cabinet)
    .bind(id_a)
    .execute(&pool)
    .await
    .expect("compte sans secret lisible");
    let y = Uuid::now_v7();
    let uri_y = format!("/messagerie/brouillons/{y}");
    let (statut, cree_y) = appel(
        &app,
        "PUT",
        &uri_y,
        &a,
        json!({"compte_id": compte_oauth, "objet": "A supprimer"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{cree_y}");
    // B n'utilise pas le compte nominatif de A : ce compte est introuvable pour lui (404, règle de
    // l'architecte du 20/10/2026 : 404 pour ce que l'utilisateur ne doit pas voir, jamais 403).
    let (statut, _) = appel(
        &app,
        "PUT",
        &format!("/messagerie/brouillons/{}", Uuid::now_v7()),
        &b,
        json!({"compte_id": compte_oauth}),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "compte nominatif d'un autre");
    let (statut, _) = appel(&app, "DELETE", &uri_y, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::NO_CONTENT);
    assert_eq!(
        compter(
            &pool,
            "SELECT COUNT(*) FROM brouillons_message WHERE id = $1",
            y
        )
        .await,
        0,
        "ligne supprimée quand aucune copie n'est à retirer"
    );
    let (statut, _) = appel(&app, "GET", &uri_y, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    // Compte de classement dont l'IMAP est injoignable : la ligne est masquée mais gardée
    // (« a_retirer ») pour que le balayage retire la copie ; elle ne revient pas.
    let z = Uuid::now_v7();
    let uri_z = format!("/messagerie/brouillons/{z}");
    appel(&app, "PUT", &uri_z, &a, json!({"objet": "Copie à retirer"})).await;
    let (statut, _) = appel(&app, "DELETE", &uri_z, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::NO_CONTENT);
    assert_eq!(
        compter(
            &pool,
            "SELECT COUNT(*) FROM brouillons_message WHERE id = $1 AND imap_etat = 'a_retirer'",
            z
        )
        .await,
        1,
        "retrait de la copie à reprendre"
    );
    let (statut, _) = appel(&app, "GET", &uri_z, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);

    completion(&app, &pool, cabinet, &a, &b, id_a).await;
}

async fn annonce_pieces(app: &axum::Router, uri: &str, jeton: &str) -> Vec<Value> {
    let (statut, lu) = appel(app, "GET", uri, jeton, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    lu["pieces"].as_array().expect("pieces").clone()
}

// ---------------------------------------------------------------------------------------------
// Complétion des destinataires
// ---------------------------------------------------------------------------------------------

async fn suggestions(app: &axum::Router, jeton: &str, q: &str, limite: Option<u32>) -> Vec<Value> {
    let mut uri = format!("/messagerie/destinataires?q={q}");
    if let Some(limite) = limite {
        uri.push_str(&format!("&limite={limite}"));
    }
    let (statut, corps) = appel(app, "GET", &uri, jeton, Value::Null).await;
    assert_eq!(statut, StatusCode::OK, "{corps}");
    corps.as_array().expect("liste").clone()
}

fn adresses(liste: &[Value]) -> Vec<String> {
    liste
        .iter()
        .map(|s| s["adresse"].as_str().unwrap().to_owned())
        .collect()
}

async fn completion(
    app: &axum::Router,
    pool: &sqlx::PgPool,
    cabinet: Uuid,
    a: &str,
    b: &str,
    id_a: Uuid,
) {
    // Annuaire : un contact avec adresse, un sans.
    let contact = Uuid::now_v7();
    let (statut, _) = appel(
        app,
        "POST",
        "/contacts",
        a,
        json!({
            "id": contact,
            "idempotence_cle": format!("brouillons-{contact}"),
            "nature": "physique",
            "nom": "Jeanne Zorglub",
            "type_client": "particulier",
            "email": "Zorglub.Jeanne@Example.com"
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let sans_mail = Uuid::now_v7();
    appel(
        app,
        "POST",
        "/contacts",
        a,
        json!({
            "id": sans_mail,
            "idempotence_cle": format!("brouillons-{sans_mail}"),
            "nature": "physique",
            "nom": "Zorglub Sansmail",
            "type_client": "particulier"
        }),
    )
    .await;

    // Compte de classement (boîte du cabinet) et boîte nominative de A.
    let classement = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM comptes_mail WHERE cabinet_id = $1 AND type_compte = 'classement'",
    )
    .bind(cabinet)
    .fetch_one(pool)
    .await
    .expect("compte de classement");
    let nominatif = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref) VALUES ($1, $2, 'nominatif', $3, 'a.zorglub@cabinet.example', 'x')",
    )
    .bind(nominatif)
    .bind(cabinet)
    .bind(id_a)
    .execute(pool)
    .await
    .expect("boîte nominative de A");

    // Dossier restreint créé par A (A seul y a accès) et dossier public.
    let restreint = Uuid::now_v7();
    let (statut, _) = appel(
        app,
        "POST",
        "/dossiers",
        a,
        json!({
            "id": restreint,
            "idempotence_cle": format!("brouillons-d-{restreint}"),
            "nom": "Dossier restreint fictif",
            "chemise": "gris-perle",
            "juridiction": "TJ Paris",
            "numero_rg": "26/20001",
            "restreint": true
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let public = Uuid::now_v7();
    let (statut, _) = appel(
        app,
        "POST",
        "/dossiers",
        a,
        json!({
            "id": public,
            "idempotence_cle": format!("brouillons-d-{public}"),
            "nom": "Dossier public fictif",
            "chemise": "gris-perle",
            "juridiction": "TJ Paris",
            "numero_rg": "26/20002",
            "restreint": false
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);

    let mut uid = 100;
    let mut message =
        |compte: Uuid, dossier: Option<Uuid>, titulaire: Option<Uuid>, de: &str, a_texte: &str| {
            uid += 1;
            (
                Uuid::now_v7(),
                compte,
                dossier,
                titulaire,
                format!("<zorglub-{uid}@example.com>"),
                uid,
                de.to_owned(),
                a_texte.to_owned(),
            )
        };
    let lignes = vec![
        message(
            classement,
            None,
            None,
            "zorglub.classement@example.com",
            "tiers@example.com, zorglub.cc@example.com",
        ),
        message(
            classement,
            Some(public),
            None,
            "zorglub.public@example.com",
            "",
        ),
        message(
            classement,
            Some(restreint),
            None,
            "zorglub.restreint@example.com",
            "zorglub.autre-restreint@example.com",
        ),
        message(
            nominatif,
            None,
            Some(id_a),
            "zorglub.nominatif@example.com",
            "",
        ),
    ];
    for (id, compte, dossier, titulaire, message_id, uid, de, a_texte) in lignes {
        sqlx::query(
            r#"
            INSERT INTO messages (id, cabinet_id, compte_id, dossier_id, titulaire_id, message_id,
                                  uid_validity, uid, objet, expediteur, destinataires_texte,
                                  etat_classement)
            VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'Objet fictif', $8, $9,
                    CASE WHEN $4::uuid IS NULL THEN 'a_classer' ELSE 'classe' END)
            "#,
        )
        .bind(id)
        .bind(cabinet)
        .bind(compte)
        .bind(dossier)
        .bind(titulaire)
        .bind(message_id)
        .bind(uid)
        .bind(de)
        .bind(a_texte)
        .execute(pool)
        .await
        .expect("message fictif");
    }

    // Envois de A : à, cc, cci avec noms.
    let envoi = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO file_envoi (id, cabinet_id, compte_id, message_id, destinataire, cc, cci,
                                objet, etat, auteur_id)
        VALUES ($1, $2, $3, '<zorglub-envoi@example.com>',
                E'Confrère Zorglub <zorglub.envoye@example.com>\nzorglub.envoye-bis@example.com',
                'zorglub.cc-envoye@example.com', 'zorglub.cci-envoye@example.com',
                'Envoi fictif', 'envoye', $4)
        "#,
    )
    .bind(envoi)
    .bind(cabinet)
    .bind(classement)
    .bind(id_a)
    .execute(pool)
    .await
    .expect("envoi fictif");

    // --- A : tout ce qu'il a le droit de lire -------------------------------------------------
    let pour_a = suggestions(app, a, "zorglub", Some(50)).await;
    let adresses_a = adresses(&pour_a);
    for attendu in [
        "zorglub.jeanne@example.com",
        "zorglub.classement@example.com",
        "zorglub.cc@example.com",
        "zorglub.public@example.com",
        "zorglub.restreint@example.com",
        "zorglub.autre-restreint@example.com",
        "zorglub.nominatif@example.com",
        "zorglub.envoye@example.com",
        "zorglub.cc-envoye@example.com",
        "zorglub.cci-envoye@example.com",
    ] {
        assert!(
            adresses_a.contains(&attendu.to_owned()),
            "A : {attendu} absent de {adresses_a:?}"
        );
    }
    assert!(
        !adresses_a.contains(&"tiers@example.com".to_owned()),
        "hors saisie"
    );
    // L'annuaire passe en premier, avec nom ; les noms des envois sont gardés.
    assert_eq!(pour_a[0]["source"], json!("annuaire"));
    assert_eq!(pour_a[0]["nom"], json!("Jeanne Zorglub"));
    let envoye = pour_a
        .iter()
        .find(|s| s["adresse"] == json!("zorglub.envoye@example.com"))
        .expect("envoyé");
    assert_eq!(envoye["source"], json!("envoye"));
    assert_eq!(envoye["nom"], json!("Confrère Zorglub"));
    // Le contact sans adresse n'est pas proposé, et aucune adresse n'apparaît deux fois.
    assert!(pour_a.iter().all(|s| s["nom"] != json!("Zorglub Sansmail")));
    let mut uniques = adresses_a.clone();
    uniques.sort();
    uniques.dedup();
    assert_eq!(uniques.len(), adresses_a.len(), "dédoublonnage");

    // --- B : ni la boîte nominative de A, ni le dossier restreint, ni les envois de A ---------
    let pour_b = suggestions(app, b, "zorglub", Some(50)).await;
    let adresses_b = adresses(&pour_b);
    for interdit in [
        "zorglub.nominatif@example.com",
        "zorglub.restreint@example.com",
        "zorglub.autre-restreint@example.com",
        "zorglub.envoye@example.com",
        "zorglub.cc-envoye@example.com",
        "zorglub.cci-envoye@example.com",
    ] {
        assert!(
            !adresses_b.contains(&interdit.to_owned()),
            "fuite vers B : {interdit}"
        );
    }
    // Essai négatif : B reçoit bien ce qu'il a le droit de voir (annuaire, boîte du cabinet,
    // dossier public), donc l'absence ci-dessus n'est pas un résultat vide.
    for attendu in [
        "zorglub.jeanne@example.com",
        "zorglub.classement@example.com",
        "zorglub.public@example.com",
    ] {
        assert!(
            adresses_b.contains(&attendu.to_owned()),
            "B : {attendu} absent"
        );
    }
    // Donner l'accès au dossier restreint à B ouvre ses adresses (la fuite était bien le filtre).
    let id_b = sqlx::query_scalar::<_, Uuid>("SELECT id FROM utilisateurs WHERE email = $1")
        .bind(COLLAB_EMAIL)
        .fetch_one(pool)
        .await
        .expect("B");
    sqlx::query(
        "INSERT INTO dossier_acces (dossier_id, utilisateur_id, dossier_texte, utilisateur_texte) VALUES ($1, $2, $3, $4)",
    )
    .bind(restreint)
    .bind(id_b)
    .bind(restreint.to_string())
    .bind(id_b.to_string())
    .execute(pool)
    .await
    .expect("accès");
    let apres_acces = adresses(&suggestions(app, b, "zorglub", Some(50)).await);
    assert!(apres_acces.contains(&"zorglub.restreint@example.com".to_owned()));
    assert!(
        !apres_acces.contains(&"zorglub.nominatif@example.com".to_owned()),
        "la boîte nominative de A reste fermée"
    );

    // --- Saisie, limite, jokers, casse ---------------------------------------------------------
    let (statut, _) = appel(app, "GET", "/messagerie/destinataires?q=z", a, Value::Null).await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "saisie d'un caractère");
    let (statut, _) = appel(app, "GET", "/messagerie/destinataires", a, Value::Null).await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "saisie absente");
    assert_eq!(suggestions(app, a, "zorglub", Some(3)).await.len(), 3);
    assert!(
        suggestions(app, a, "zorglub", None).await.len() <= 8,
        "limite par défaut"
    );
    assert!(
        suggestions(app, a, "%25%25", Some(50)).await.is_empty(),
        "jokers neutralisés"
    );
    assert!(
        suggestions(app, a, "z_rglub", Some(50)).await.is_empty(),
        "_ est un caractère ordinaire"
    );
    let majuscules = suggestions(app, a, "ZORGLUB.JEANNE", Some(50)).await;
    assert_eq!(
        majuscules.len(),
        1,
        "recherche insensible à la casse, sans doublon"
    );
}
