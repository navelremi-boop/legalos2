//! Création de dossier par l'API (Postgres réel), dossier restreint compris, sur un pool d'une seule connexion
//! après un renouvellement de jeton OAuth.
//!
//! Non-régression du 22/10/2026 : `POST /dossiers` répondait 500 « verrou dossier » parce que le renouvellement
//! de jeton (`oauth_mail`) avait préparé, sur la même connexion, le même texte SQL de verrou avec un paramètre
//! `text`, que la création de dossier réutilisait avec un `Uuid` binaire (cache de requêtes préparées de sqlx).
//! Le pool d'une connexion force ce partage ; `cargo test` ne le voyait pas parce qu'aucun moteur n'y renouvelle
//! de jeton.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use legalos_api::build_app_state;
use legalos_api::build_router;
use legalos_api::config::Config;
use serde_json::{json, Value};
use totp_rs::{Algorithm, Builder, Secret, Totp};
use tower::ServiceExt;
use uuid::Uuid;

#[path = "support/mod.rs"]
mod support;

use support::demo_seed::{DEMO_CABINET_ID, DEMO_EMAIL, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32};

fn ensure_test_env() {
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

fn require_database_url() {
    std::env::var("DATABASE_URL").expect("DATABASE_URL requis (Postgres réel)");
}

async fn test_app() -> (axum::Router, sqlx::PgPool) {
    ensure_test_env();
    let mut config = Config::from_env().expect("DATABASE_URL requis");
    config.run_migrations = false;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&config.database_url)
        .await
        .expect("connexion Postgres");
    legalos_api::db::appliquer_migrations(&pool)
        .await
        .expect("migrations");
    seed_compte_recette(&pool).await;
    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    (build_router(state), pool)
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

async fn seed_compte_recette(pool: &sqlx::PgPool) {
    sqlx::query("SELECT pg_advisory_lock(8042005)")
        .execute(pool)
        .await
        .expect("verrou");
    let hash = legalos_api::auth::password::hash_password(DEMO_PASSWORD).expect("hash");
    let totp = legalos_api::auth::totp::chiffrer_secret_totp(
        DEMO_TOTP_SECRET_BASE32.as_bytes(),
        b"legalos_demo_chiffrement_32oct!!",
    )
    .expect("totp");
    sqlx::query(
        r#"
        INSERT INTO cabinets (id, slug, nom, totp_obligatoire)
        VALUES ($1, 'demo-fictif', 'Cabinet fictif LEGAL OS', TRUE)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(uuid_recette(DEMO_CABINET_ID))
    .execute(pool)
    .await
    .expect("cabinet");
    sqlx::query(
        r#"
        INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        ON CONFLICT (id) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            totp_secret_chiffre = EXCLUDED.totp_secret_chiffre
        "#,
    )
    .bind(uuid_recette(support::demo_seed::DEMO_USER_ID))
    .bind(uuid_recette(DEMO_CABINET_ID))
    .bind(DEMO_EMAIL)
    .bind(hash)
    .bind(totp)
    .execute(pool)
    .await
    .expect("utilisateur");
    sqlx::query("SELECT pg_advisory_unlock(8042005)")
        .execute(pool)
        .await
        .expect("deverrouillage");
}

fn uuid_recette(valeur: &str) -> Uuid {
    Uuid::parse_str(valeur).expect("uuid")
}

fn demo_totp_code() -> String {
    let secret = Secret::try_from_base32(DEMO_TOTP_SECRET_BASE32).expect("secret");
    let totp: Totp = Builder::new()
        .with_secret(secret.as_bytes().to_vec())
        .with_algorithm(Algorithm::SHA1)
        .with_account_name(DEMO_EMAIL)
        .with_issuer(Some("LEGAL OS"))
        .build()
        .expect("totp");
    totp.generate_current().to_string()
}

async fn access_token(app: &axum::Router, nom_appareil: &str) -> String {
    let connexion = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/connexion")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": DEMO_EMAIL,
                        "password": DEMO_PASSWORD,
                        "nom_appareil": nom_appareil
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(connexion.status(), StatusCode::OK);
    let session = json_body(connexion).await["session_token"]
        .as_str()
        .expect("session")
        .to_string();
    let verify = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/totp/verifier")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "session_token": session,
                        "code_totp": demo_totp_code()
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(verify.status(), StatusCode::OK);
    json_body(verify).await["access_token"]
        .as_str()
        .expect("access")
        .to_string()
}

async fn json_auth(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    (status, json_body(response).await)
}

fn corps_dossier(id: Uuid, restreint: bool) -> Value {
    json!({
        "id": id,
        "idempotence_cle": format!("creation-{id}"),
        "nom": format!("Dossier création {id}"),
        "chemise": "kraft",
        "juridiction": "TJ Nanterre",
        "numero_rg": "26/20001",
        "restreint": restreint
    })
}

#[tokio::test]
async fn creation_de_dossier_apres_un_renouvellement_oauth_sur_la_meme_connexion() {
    ensure_test_env();
    require_database_url();
    let (app, pool) = test_app().await;
    let token = access_token(&app, "dossiers-creation-poste").await;

    let compte = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)          VALUES ($1, $2, 'nominatif', $3, $4, 'oauth')",
    )
    .bind(compte)
    .bind(uuid_recette(DEMO_CABINET_ID))
    .bind(uuid_recette(support::demo_seed::DEMO_USER_ID))
    .bind(format!("creation-{compte}@cabinet-fictif.example"))
    .execute(&pool)
    .await
    .expect("compte OAuth fictif");

    // Le renouvellement prend le verrou de la boîte (clé texte) sur l'unique connexion du pool, puis échoue
    // faute de jeton : ce qui compte est la requête préparée qu'il laisse sur la connexion.
    let (statut, _) = json_auth(
        &app,
        "POST",
        "/messagerie/oauth/renouveler",
        &token,
        json!({ "id": compte }),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);

    for restreint in [false, true] {
        let id = Uuid::now_v7();
        let (statut, cree) = json_auth(
            &app,
            "POST",
            "/dossiers",
            &token,
            corps_dossier(id, restreint),
        )
        .await;
        assert_eq!(statut, StatusCode::OK, "restreint={restreint} : {cree:?}");
        assert_eq!(cree["restreint"], json!(restreint));
        let (nom_en_base, restreint_en_base): (String, bool) =
            sqlx::query_as("SELECT nom, restreint FROM dossiers WHERE id = $1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("dossier créé");
        assert!(nom_en_base.contains(&id.to_string()));
        assert_eq!(restreint_en_base, restreint);

        // Rejeu du même envoi : même dossier, pas de doublon ni de 500.
        let (rejeu, rejoue) = json_auth(
            &app,
            "POST",
            "/dossiers",
            &token,
            corps_dossier(id, restreint),
        )
        .await;
        assert_eq!(
            rejeu,
            StatusCode::OK,
            "rejeu restreint={restreint} : {rejoue:?}"
        );
        assert_eq!(rejoue["id"], cree["id"]);
        assert_eq!(rejoue["reference"], cree["reference"]);
    }

    sqlx::query("DELETE FROM comptes_mail WHERE id = $1")
        .bind(compte)
        .execute(&pool)
        .await
        .expect("nettoyage");
}
