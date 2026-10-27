//! J11 étape 1a : routes de rédaction contre un Postgres réel, sans IMAP ni SMTP.
//!
//! Une base jetable est créée puis supprimée : les migrations de l'instance de développement
//! ne sont jamais appliquées par ce test. Couvre les requêtes SQL non vérifiées à la compilation
//! (composition, signature, modèles, file d'envoi) et les droits entre deux collaborateurs.
//! L'envoi réel (SMTP, copie « Envoyés ») est couvert par `tests/recette/j11-redaction-api.mjs`.
#![allow(clippy::expect_used, clippy::unwrap_used)]

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

const COLLAB_EMAIL: &str = "collaborateur-redaction@cabinet-fictif.example";
const COLLAB_TOTP: &str = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
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
    let reponse = app
        .clone()
        .oneshot(
            Request::builder()
                .method(methode)
                .uri(uri)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {jeton}"))
                .body(Body::from(contenu.to_string()))
                .unwrap(),
        )
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
                    json!({"email": email, "password": mot_de_passe, "nom_appareil": "test-redaction"})
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
    role: &str,
) {
    let hash = legalos_api::auth::password::hash_password(mot_de_passe).expect("hash");
    let secret = legalos_api::auth::totp::chiffrer_secret_totp(totp.as_bytes(), CLE).expect("totp");
    sqlx::query(
        "INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif, role) VALUES ($1, $2, $3, $4, $5, TRUE, $6)",
    )
    .bind(id)
    .bind(cabinet)
    .bind(email)
    .bind(hash)
    .bind(secret)
    .bind(role)
    .execute(pool)
    .await
    .expect("utilisateur");
}

#[tokio::test]
async fn redaction_signatures_modeles_file_et_droits() {
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
    let base = format!("legalos_redaction_{nanos}");
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
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, 'redaction', 'Cabinet fictif', TRUE)")
        .bind(cabinet)
        .execute(&pool)
        .await
        .expect("cabinet");
    let email_a = "titulaire-redaction@cabinet-fictif.example";
    creer_utilisateur(
        &pool,
        cabinet,
        Uuid::now_v7(),
        email_a,
        DEMO_PASSWORD,
        DEMO_TOTP_SECRET_BASE32,
        "administrateur",
    )
    .await;
    creer_utilisateur(
        &pool,
        cabinet,
        Uuid::now_v7(),
        COLLAB_EMAIL,
        DEMO_PASSWORD,
        COLLAB_TOTP,
        "collaborateur",
    )
    .await;

    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    let app = build_router(state);
    let a = jeton(&app, email_a, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32).await;
    let b = jeton(&app, COLLAB_EMAIL, DEMO_PASSWORD, COLLAB_TOTP).await;

    // --- Composition : message neuf sans destinataire, injections refusées ------------------
    let (statut, neuf) = appel(
        &app,
        "POST",
        "/messagerie/composition",
        &a,
        json!({"genre": "nouveau"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{neuf}");
    assert_eq!(neuf["a"], json!([]));
    assert_eq!(neuf["signature_inseree"], json!(false));
    assert!(neuf["message_id"].as_str().unwrap().starts_with("<envoi-"));
    let compte_classement = neuf["compte_id"].as_str().expect("compte").to_owned();

    for (nom, requete) in [
        (
            "objet",
            json!({"genre": "nouveau", "a": ["x@example.com"], "objet": "Note\r\nBcc: p@example.com"}),
        ),
        (
            "adresse",
            json!({"genre": "nouveau", "a": ["x@example.com\r\nBcc: p@example.com"]}),
        ),
        ("genre", json!({"genre": "repondre"})),
        ("origine absente", json!({"genre": "reponse"})),
    ] {
        let (statut, _) = appel(&app, "POST", "/messagerie/composition", &a, requete).await;
        assert_eq!(
            statut,
            StatusCode::BAD_REQUEST,
            "composition refusée : {nom}"
        );
    }
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/composition",
        &a,
        json!({"genre": "reponse", "message_id": Uuid::now_v7()}),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/composition",
        &a,
        json!({"genre": "nouveau", "a": ["x@example.com"], "objet": "Note"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "contrôle positif de composition");

    // --- Signature : une par compte et par utilisateur ---------------------------------------
    let uri_signature = format!("/messagerie/comptes/{compte_classement}/signature");
    let (statut, ecrite) = appel(
        &app,
        "PUT",
        &uri_signature,
        &a,
        json!({"texte": "Me Signataire Fictif", "html": "<p>Me Signataire Fictif</p><script>x()</script>"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{ecrite}");
    assert!(!ecrite["html"].as_str().unwrap().contains("script"));
    assert_eq!(ecrite["revision"], json!(1));
    let (_, ecrite) = appel(
        &app,
        "PUT",
        &uri_signature,
        &a,
        json!({"texte": "Me Signataire Fictif, avocat"}),
    )
    .await;
    assert_eq!(ecrite["revision"], json!(2));
    let (_, avec) = appel(
        &app,
        "POST",
        "/messagerie/composition",
        &a,
        json!({"genre": "nouveau"}),
    )
    .await;
    assert_eq!(avec["signature_inseree"], json!(true));
    assert!(avec["texte"]
        .as_str()
        .unwrap()
        .contains("Me Signataire Fictif, avocat"));
    let (_, sans) = appel(
        &app,
        "POST",
        "/messagerie/composition",
        &b,
        json!({"genre": "nouveau"}),
    )
    .await;
    assert_eq!(sans["signature_inseree"], json!(false));
    assert!(!sans["texte"].as_str().unwrap().contains("Signataire"));
    let (statut, lue_b) = appel(&app, "GET", &uri_signature, &b, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(lue_b["revision"], json!(0));
    assert_eq!(lue_b["texte"], json!(""));

    // --- Modèles du cabinet -------------------------------------------------------------------
    let id_modele = Uuid::now_v7();
    let (statut, modele) = appel(
        &app,
        "POST",
        "/messagerie/modeles",
        &a,
        json!({
            "id": id_modele,
            "nom": "Accusé de réception",
            "objet": "Accusé",
            "corps_html": "<p>Nous accusons réception.</p><script>alert(1)</script>",
            "ordre": 2
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{modele}");
    assert!(!modele["corps_html"].as_str().unwrap().contains("script"));
    // Rejeu du même identifiant : la ligne existante, pas de doublon.
    let (statut, rejeu) = appel(
        &app,
        "POST",
        "/messagerie/modeles",
        &a,
        json!({"id": id_modele, "nom": "Accusé de réception"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(rejeu["id"], modele["id"]);
    for (nom, requete, attendu) in [
        (
            "doublon insensible à la casse",
            json!({"id": Uuid::now_v7(), "nom": "ACCUSÉ DE RÉCEPTION"}),
            StatusCode::CONFLICT,
        ),
        (
            "nom vide",
            json!({"id": Uuid::now_v7(), "nom": "  "}),
            StatusCode::BAD_REQUEST,
        ),
        (
            "objet injecté",
            json!({"id": Uuid::now_v7(), "nom": "Autre", "objet": "x\r\nBcc: p@example.com"}),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let (statut, _) = appel(&app, "POST", "/messagerie/modeles", &a, requete).await;
        assert_eq!(statut, attendu, "modèle : {nom}");
    }
    let id_second = Uuid::now_v7();
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/modeles",
        &a,
        json!({"id": id_second, "nom": "Convocation"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let (statut, _) = appel(
        &app,
        "PATCH",
        &format!("/messagerie/modeles/{id_second}"),
        &a,
        json!({"nom": "accusé DE réception"}),
    )
    .await;
    assert_eq!(statut, StatusCode::CONFLICT, "renommage vers un nom pris");
    let (statut, _) = appel(
        &app,
        "PATCH",
        &format!("/messagerie/modeles/{id_second}"),
        &a,
        json!({"nom": "Convocation d'audience"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    // Rôles (dette « rôle administrateur », consigne du 14/10/2026) : un collaborateur lit les modèles, ne les écrit pas
    // (403 : la ressource est visible, l'action est interdite) ; il ne crée pas de compte ; l'administrateur le peut.
    for (libelle, methode, uri, corps) in [
        (
            "création",
            "POST",
            "/messagerie/modeles".to_owned(),
            json!({"id": Uuid::now_v7(), "nom": "Modèle de B"}),
        ),
        (
            "modification",
            "PATCH",
            format!("/messagerie/modeles/{id_second}"),
            json!({"nom": "Renommé par B"}),
        ),
        (
            "suppression",
            "DELETE",
            format!("/messagerie/modeles/{id_second}"),
            Value::Null,
        ),
        (
            "création d'un compte",
            "POST",
            "/collaborateurs".to_owned(),
            json!({"email": "nouveau@cabinet.example", "password": "un mot de passe long", "totp_secret_base32": "ABCDEFGHIJKLMNOP"}),
        ),
    ] {
        let (statut, _) = appel(&app, methode, &uri, &b, corps).await;
        assert_eq!(
            statut,
            StatusCode::FORBIDDEN,
            "un collaborateur ne fait pas : {libelle}"
        );
    }
    let (statut, liste_modeles_b) =
        appel(&app, "GET", "/messagerie/modeles", &b, Value::Null).await;
    assert_eq!(statut, StatusCode::OK, "un collaborateur lit les modèles");
    assert!(liste_modeles_b.as_array().is_some_and(|l| !l.is_empty()));
    let (statut, collaborateurs) = appel(&app, "GET", "/collaborateurs", &b, Value::Null).await;
    assert_eq!(statut, StatusCode::OK);
    let roles: Vec<(String, String)> = collaborateurs
        .as_array()
        .expect("liste")
        .iter()
        .map(|c| {
            (
                c["email"].as_str().unwrap_or("").to_owned(),
                c["role"].as_str().unwrap_or("").to_owned(),
            )
        })
        .collect();
    assert!(
        roles
            .iter()
            .any(|(e, r)| e == COLLAB_EMAIL && r == "collaborateur"),
        "{roles:?}"
    );
    assert!(
        roles.iter().any(|(_, r)| r == "administrateur"),
        "{roles:?}"
    );
    // Rien n'a changé du fait des refus : le second modèle porte toujours son nom.
    let (_, apres) = appel(&app, "GET", "/messagerie/modeles", &a, Value::Null).await;
    assert!(apres
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == json!(id_second) && m["nom"] == json!("Convocation d'audience")));
    let (statut, _) = appel(
        &app,
        "GET",
        "/messagerie/oauth/application",
        &b,
        Value::Null,
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::FORBIDDEN,
        "un collaborateur ne lit pas les identifiants d'application OAuth"
    );
    let (statut, application) = appel(
        &app,
        "GET",
        "/messagerie/oauth/application",
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{application}");
    assert!(application
        .get("microsoft")
        .and_then(|v| v.as_bool())
        .is_some());
    assert!(application.get("gmail").and_then(|v| v.as_bool()).is_some());
    assert!(
        application.get("client_id").is_none() && application.get("client_secret").is_none(),
        "aucune valeur d'identifiant dans la réponse : {application}"
    );
    let (statut, _) = appel(
        &app,
        "PUT",
        "/messagerie/oauth/application",
        &b,
        json!({"fournisseur": "gmail", "client_id": "gmail-fictif.apps"}),
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::FORBIDDEN,
        "un collaborateur n'écrit pas les identifiants d'application"
    );
    let (statut, _) = appel(
        &app,
        "PUT",
        "/messagerie/oauth/application",
        &a,
        json!({"fournisseur": "gmail", "client_id": "gmail secret avec espace"}),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "valeur dangereuse refusée");
    let (statut, apres) = appel(
        &app,
        "PUT",
        "/messagerie/oauth/application",
        &a,
        json!({"fournisseur": "gmail", "client_id": "gmail-fictif.apps"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{apres}");
    assert_eq!(apres["gmail"], json!(true));
    let (statut, relue) = appel(
        &app,
        "GET",
        "/messagerie/oauth/application",
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(relue["gmail"], json!(true));
    let (statut, retiree) = appel(
        &app,
        "PUT",
        "/messagerie/oauth/application",
        &a,
        json!({"fournisseur": "gmail", "client_id": ""}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{retiree}");
    assert_eq!(retiree["gmail"], json!(false));
    let (statut, cree) = appel(
        &app,
        "POST",
        "/collaborateurs",
        &a,
        json!({"email": "nouveau@cabinet.example", "password": "un mot de passe long", "totp_secret_base32": "ABCDEFGHIJKLMNOP"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{cree}");
    assert_eq!(
        cree["role"],
        json!("collaborateur"),
        "un compte créé par l'API n'est jamais administrateur"
    );
    let (_, liste_b) = appel(&app, "GET", "/messagerie/modeles", &b, Value::Null).await;
    assert!(liste_b
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == modele["id"]));
    let (_, depart) = appel(
        &app,
        "POST",
        "/messagerie/composition",
        &a,
        json!({"genre": "nouveau", "modele_id": id_modele}),
    )
    .await;
    assert_eq!(depart["objet"], json!("Accusé"));
    assert!(depart["html"]
        .as_str()
        .unwrap()
        .contains("accusons réception"));
    let uri_modele = format!("/messagerie/modeles/{id_modele}");
    let (statut, _) = appel(&app, "PATCH", &uri_modele, &a, json!({"actif": false})).await;
    assert_eq!(statut, StatusCode::OK);
    let (_, actifs) = appel(&app, "GET", "/messagerie/modeles", &a, Value::Null).await;
    // Reste actif le seul second modèle ; le modèle désactivé n'est plus listé.
    let actifs = actifs.as_array().unwrap();
    assert_eq!(actifs.len(), 1);
    assert_eq!(actifs[0]["id"], json!(id_second));
    let (_, tous) = appel(
        &app,
        "GET",
        "/messagerie/modeles?tous=true",
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(tous.as_array().unwrap().len(), 2);
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/composition",
        &a,
        json!({"genre": "nouveau", "modele_id": id_modele}),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "modèle désactivé");
    let (statut, _) = appel(&app, "DELETE", &uri_modele, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::NO_CONTENT);
    let (statut, _) = appel(&app, "DELETE", &uri_modele, &a, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);

    // --- File d'envoi : création, en-têtes non injectables, droits -----------------------------
    let id_envoi = Uuid::now_v7();
    let (statut, envoi) = appel(
        &app,
        "POST",
        "/messagerie/file-envoi",
        &a,
        json!({
            "id": id_envoi,
            "idempotence_cle": "k1",
            "a": ["Confrere Fictif <confrere@example.com>"],
            "cc": ["copie@example.com"],
            "cci": ["cachee@example.com"],
            "objet": "Envoi fictif",
            "corps_html": "<p>Corps</p><script>x()</script>",
            "message_id": "<redaction-test-1@cabinet.example>"
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{envoi}");
    assert_eq!(envoi["etat"], json!("brouillon"));
    assert_eq!(envoi["cci"], json!(["cachee@example.com"]));
    assert_eq!(
        envoi["message_id"],
        json!("<redaction-test-1@cabinet.example>")
    );
    let html_stocke: String = sqlx::query_scalar("SELECT corps_html FROM file_envoi WHERE id = $1")
        .bind(id_envoi)
        .fetch_one(&pool)
        .await
        .expect("corps");
    assert!(html_stocke.contains("Corps") && !html_stocke.contains("script"));
    // Rejeu : même ligne.
    let (statut, rejeu) = appel(
        &app,
        "POST",
        "/messagerie/file-envoi",
        &a,
        json!({
            "id": id_envoi, "idempotence_cle": "k1", "a": ["Confrere Fictif <confrere@example.com>"],
            "objet": "Envoi fictif", "message_id": "<redaction-test-1@cabinet.example>"
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(rejeu["id"], envoi["id"]);
    let lignes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM file_envoi WHERE message_id = '<redaction-test-1@cabinet.example>'",
    )
    .fetch_one(&pool)
    .await
    .expect("comptage");
    assert_eq!(lignes, 1);
    // Corps historique (ancien format) toujours accepté : un « destinataire » et un dossier absent.
    let (statut, ancien) = appel(
        &app,
        "POST",
        "/messagerie/file-envoi",
        &a,
        json!({
            "id": Uuid::now_v7(), "idempotence_cle": "k-ancien",
            "destinataire": "ancien@example.com", "objet": "Ancien format", "corps": "Texte"
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{ancien}");
    assert_eq!(ancien["a"], json!(["ancien@example.com"]));

    let injections = [
        ("objet", json!({"objet": "Envoi\r\nBcc: p@example.com"})),
        ("à", json!({"a": ["c@example.com\nBcc: p@example.com"]})),
        ("cc", json!({"cc": ["c@example.com\r\nX-Injecte: oui"]})),
        ("cci", json!({"cci": ["c@example.com\r\nX-Injecte: oui"]})),
        (
            "In-Reply-To",
            json!({"en_reponse_a": "<x@example.com>\r\nBcc: p@example.com"}),
        ),
        (
            "Message-ID",
            json!({"message_id": "<x@example.com>\r\nBcc: p@example.com"}),
        ),
        ("genre sans origine", json!({"genre": "reponse"})),
        ("sans destinataire", json!({"a": [], "destinataire": ""})),
    ];
    for (nom, extra) in injections {
        let id = Uuid::now_v7();
        let mut requete = json!({
            "id": id, "idempotence_cle": format!("k-{nom}"),
            "a": ["destinataire@example.com"], "objet": "Envoi sain"
        });
        for (cle, valeur) in extra.as_object().unwrap() {
            requete[cle] = valeur.clone();
        }
        let (statut, reponse) = appel(&app, "POST", "/messagerie/file-envoi", &a, requete).await;
        assert_eq!(
            statut,
            StatusCode::BAD_REQUEST,
            "injection par {nom} : {reponse}"
        );
        let existe: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_envoi WHERE id = $1")
            .bind(id)
            .fetch_one(&pool)
            .await
            .expect("comptage");
        assert_eq!(existe, 0, "aucune ligne pour l'injection par {nom}");
    }

    // Droits sur le brouillon d'un autre collaborateur.
    let (_, liste_b) = appel(&app, "GET", "/messagerie/file-envoi", &b, Value::Null).await;
    assert!(
        liste_b.as_array().unwrap().is_empty(),
        "B voit la file de A"
    );
    let (_, liste_a) = appel(&app, "GET", "/messagerie/file-envoi", &a, Value::Null).await;
    assert_eq!(liste_a.as_array().unwrap().len(), 2);
    for chemin in ["mettre-en-attente", "annuler", "traiter"] {
        let (statut, _) = appel(
            &app,
            "POST",
            &format!("/messagerie/file-envoi/{id_envoi}/{chemin}"),
            &b,
            Value::Null,
        )
        .await;
        assert_eq!(
            statut,
            StatusCode::NOT_FOUND,
            "B sur le brouillon de A : {chemin}"
        );
    }
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/file-envoi",
        &b,
        json!({"id": id_envoi, "idempotence_cle": "k-b", "a": ["x@example.com"], "objet": "Usurpation"}),
    )
    .await;
    assert_eq!(statut, StatusCode::CONFLICT);
    let (statut, en_attente) = appel(
        &app,
        "POST",
        &format!("/messagerie/file-envoi/{id_envoi}/mettre-en-attente"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(en_attente["etat"], json!("en_attente"));

    // --- Boîte nominative d'un autre : signature et messages introuvables -----------------------
    let id_compte_a = Uuid::now_v7();
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/comptes",
        &a,
        json!({
            "id": id_compte_a, "adresse": "a@cabinet.example", "hote": "127.0.0.1", "port": 1,
            "utilisateur": "a", "mot_de_passe": "SentinelleFictive", "tls": false
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let uri_compte_a = format!("/messagerie/comptes/{id_compte_a}/signature");
    let (statut, _) = appel(&app, "GET", &uri_compte_a, &b, Value::Null).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    let (statut, _) = appel(&app, "PUT", &uri_compte_a, &b, json!({"texte": "Intrus"})).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    let (statut, _) = appel(
        &app,
        "PUT",
        &uri_compte_a,
        &a,
        json!({"texte": "Signature de A"}),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let intrus: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM signatures_messagerie WHERE texte = 'Intrus'")
            .fetch_one(&pool)
            .await
            .expect("comptage");
    assert_eq!(intrus, 0);

    let id_message = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet,
                              expediteur, etat_classement)
        VALUES ($1, $2, $3, '<nominatif-test@example.com>', 1, 1, 'Message nominatif fictif',
                'tiers@example.com', 'a_classer')
        "#,
    )
    .bind(id_message)
    .bind(cabinet)
    .bind(id_compte_a)
    .execute(&pool)
    .await
    .expect("message");
    let demande = json!({"genre": "reponse", "message_id": id_message});
    let (statut, _) = appel(&app, "POST", "/messagerie/composition", &b, demande.clone()).await;
    assert_eq!(
        statut,
        StatusCode::NOT_FOUND,
        "B compose depuis la boîte de A"
    );
    let (statut, _) = appel(&app, "POST", "/messagerie/composition", &a, demande).await;
    assert_eq!(
        statut,
        StatusCode::BAD_GATEWAY,
        "A atteint sa boîte (injoignable ici), il n'est pas refusé"
    );
    let (_, messages_b) = appel(&app, "GET", "/messagerie/messages", &b, Value::Null).await;
    assert!(
        messages_b.as_array().unwrap().is_empty(),
        "B voit un message de A"
    );
    let (_, messages_a) = appel(&app, "GET", "/messagerie/messages", &a, Value::Null).await;
    assert_eq!(messages_a.as_array().unwrap().len(), 1);
    let (statut, _) = appel(
        &app,
        "POST",
        "/messagerie/file-envoi",
        &b,
        json!({
            "id": Uuid::now_v7(), "idempotence_cle": "k-origine", "genre": "reponse",
            "origine_message_id": id_message, "a": ["x@example.com"], "objet": "Re: fictif"
        }),
    )
    .await;
    assert_eq!(
        statut,
        StatusCode::NOT_FOUND,
        "B répond à un message de la boîte de A"
    );

    pool.close().await;
}
