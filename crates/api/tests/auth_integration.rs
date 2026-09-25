//! Auth + TOTP contre Postgres (migration 004). Nécessite `DATABASE_URL`.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use legalos_api::build_app_state;
use legalos_api::build_router;
use legalos_api::config::Config;
use serde_json::json;
use totp_rs::{Algorithm, Builder, Secret, Totp};
use tower::ServiceExt;

#[path = "support/mod.rs"]
mod support;

use support::demo_seed::{DEMO_EMAIL, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32};

fn ensure_test_env() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = dotenvy::dotenv();
        // Migration 004 : clé fictive documentée (32 octets).
        std::env::set_var(
            "SECRETS_CHIFFREMENT_KEY",
            "legalos_demo_chiffrement_32oct!!",
        );
        std::env::set_var("LEGALOS_MODE", "development");
    });
}

fn require_database_url() {
    std::env::var("DATABASE_URL")
        .expect("DATABASE_URL requis pour auth_integration (Postgres réel, ex. instance S1)");
}

async fn test_app() -> axum::Router {
    ensure_test_env();
    let mut config = Config::from_env().expect("DATABASE_URL requis");
    // Migrations appliquées par l'API (compose) ; évite les conflits de checksum sqlx en dev parallèle.
    config.run_migrations = false;
    let pool = legalos_api::db::connect_pool(&config.database_url)
        .await
        .expect("connexion Postgres");
    legalos_api::db::appliquer_migrations(&pool)
        .await
        .expect("migrations");
    seed_compte_recette(&pool).await;
    let state = build_app_state(&config, pool).await.expect("AppState");
    build_router(state)
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("json")
}

async fn seed_compte_recette(pool: &sqlx::PgPool) {
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
    .bind(uuid_recette(support::demo_seed::DEMO_CABINET_ID))
    .execute(pool)
    .await
    .expect("cabinet recette");
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
    .bind(uuid_recette(support::demo_seed::DEMO_CABINET_ID))
    .bind(DEMO_EMAIL)
    .bind(hash)
    .bind(totp)
    .execute(pool)
    .await
    .expect("utilisateur recette");
}

fn uuid_recette(valeur: &str) -> uuid::Uuid {
    uuid::Uuid::parse_str(valeur).expect("uuid recette")
}

fn demo_totp_code() -> String {
    let secret = Secret::try_from_base32(DEMO_TOTP_SECRET_BASE32).expect("secret demo");
    let totp: Totp = Builder::new()
        .with_secret(secret.as_bytes().to_vec())
        .with_algorithm(Algorithm::SHA1)
        .with_account_name(DEMO_EMAIL)
        .with_issuer(Some("LEGAL OS"))
        .build()
        .expect("totp demo");
    totp.generate_current().to_string()
}

#[tokio::test]
async fn auth_connexion_echoue_mot_de_passe_invalide() {
    ensure_test_env();
    require_database_url();
    let app = test_app().await;
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/connexion")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": DEMO_EMAIL,
                        "password": "mot-de-passe-faux",
                        "nom_appareil": "test-integration"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_flow_totp_et_jwks() {
    ensure_test_env();
    require_database_url();
    let app = test_app().await;

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
                        "nom_appareil": "test-integration-recette"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(connexion.status(), StatusCode::OK);
    let connexion_json = json_body(connexion).await;
    assert_eq!(connexion_json["totp_requis"], true);
    assert!(connexion_json["session_token"].as_str().is_some());
    assert!(connexion_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .is_none());

    let session_token = connexion_json["session_token"]
        .as_str()
        .expect("session_token")
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
                        "session_token": session_token,
                        "code_totp": demo_totp_code()
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(verify.status(), StatusCode::OK);
    let verify_json = json_body(verify).await;
    assert!(verify_json["access_token"]
        .as_str()
        .is_some_and(|s| !s.is_empty()));
    assert!(verify_json["refresh_token"]
        .as_str()
        .is_some_and(|s| !s.is_empty()));

    let jwks = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/auth/jwks")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(jwks.status(), StatusCode::OK);
    let jwks_json = json_body(jwks).await;
    let keys = jwks_json["keys"].as_array().expect("keys");
    assert!(!keys.is_empty());
    assert_eq!(keys[0]["alg"], "RS256");
}
