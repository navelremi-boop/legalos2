//! Intercalaires personnalisés : créer, renommer, conflit de champ, retrait sans perte métier.
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
        std::env::set_var(
            "SECRETS_CHIFFREMENT_KEY",
            "legalos_demo_chiffrement_32oct!!",
        );
        std::env::set_var("LEGALOS_MODE", "development");
    });
}

fn require_database_url() {
    std::env::var("DATABASE_URL")
        .expect("DATABASE_URL requis pour intercalaires_integration (Postgres réel)");
}

async fn test_app() -> (axum::Router, sqlx::PgPool) {
    ensure_test_env();
    let mut config = Config::from_env().expect("DATABASE_URL requis");
    config.run_migrations = false;
    let pool = legalos_api::db::connect_pool(&config.database_url)
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
    serde_json::from_slice(&bytes).expect("json")
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
    let json = json_body(response).await;
    (status, json)
}

#[tokio::test]
async fn creer_renommer_conflit_retrait_conserve_piece() {
    ensure_test_env();
    require_database_url();
    let (app, pool) = test_app().await;
    let token_a = access_token(&app, "intercalaires-poste-a").await;
    let token_b = access_token(&app, "intercalaires-poste-b").await;
    let serie = Uuid::now_v7();
    let cle = |suffix: &str| format!("{serie}-{suffix}");

    let dossier_id = Uuid::now_v7();
    let (st, dossier) = json_auth(
        &app,
        "POST",
        "/dossiers",
        &token_a,
        json!({
            "id": dossier_id,
            "idempotence_cle": format!("creer-d-{dossier_id}"),
            "nom": "Dossier intercalaires",
            "chemise": "kraft",
            "juridiction": "TJ Nanterre",
            "numero_rg": "26/00042",
            "restreint": false
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{dossier:?}");

    // Pièce métier insérée directement (évite le dépôt S3 hors périmètre de ce test).
    let piece_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO documents (id, cabinet_id, dossier_id, nom, visibilite, dossier_texte)
        SELECT $1, $2, dossiers.id, 'Piece chronometree', dossiers.visibilite, dossiers.id::text
        FROM dossiers WHERE dossiers.id = $3
        "#,
    )
    .bind(piece_id)
    .bind(uuid_recette(DEMO_CABINET_ID))
    .bind(dossier_id)
    .execute(&pool)
    .await
    .expect("piece metier");

    let intercalaire_id = Uuid::now_v7();
    let (st, cree) = json_auth(
        &app,
        "POST",
        &format!("/dossiers/{dossier_id}/intercalaires"),
        &token_a,
        json!({
            "id": intercalaire_id,
            "idempotence_cle": format!("creer-i-{intercalaire_id}"),
            "nom": "Pieces utiles"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{cree:?}");
    assert_eq!(cree["nom"], "Pieces utiles");
    assert_eq!(cree["revision"], 1);

    let lien_id = Uuid::now_v7();
    let (st, lien) = json_auth(
        &app,
        "POST",
        &format!("/intercalaires/{intercalaire_id}/elements"),
        &token_a,
        json!({
            "id": lien_id,
            "idempotence_cle": format!("rattacher-{lien_id}"),
            "type_element": "piece",
            "element_id": piece_id
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{lien:?}");

    let piece_toujours: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents WHERE id = $1")
        .bind(piece_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(piece_toujours, 1, "rattacher ne retire pas la piece du chrono");

    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/intercalaires/{intercalaire_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": cle("i-nom-a"),
            "nom": "Nom A"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/intercalaires/{intercalaire_id}"),
        &token_b,
        json!({
            "base_revision": 1,
            "idempotence_cle": cle("i-nom-b"),
            "nom": "Nom B"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let (val, conflit, d_id): (String, bool, Option<Uuid>) = sqlx::query_as(
        r#"
        SELECT valeur_appliquee, conflit, dossier_id FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'nom' AND table_cible = 'intercalaires_personnalises'
        ORDER BY revision_appliquee DESC LIMIT 1
        "#,
    )
    .bind(intercalaire_id)
    .fetch_one(&pool)
    .await
    .expect("journal intercalaire");
    assert_eq!(val, "Nom B");
    assert!(conflit, "conflit attendu entre deux postes");
    assert_eq!(d_id, Some(dossier_id));

    let (st, retire) = json_auth(
        &app,
        "DELETE",
        &format!("/intercalaires/{intercalaire_id}"),
        &token_a,
        json!({ "idempotence_cle": cle("i-delete") }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{retire:?}");
    assert_eq!(retire["retire"], true);

    let intercalaire_reste: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM intercalaires_personnalises WHERE id = $1")
            .bind(intercalaire_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(intercalaire_reste, 0);

    let liens_restants: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM intercalaire_elements WHERE intercalaire_id = $1")
            .bind(intercalaire_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(liens_restants, 0, "CASCADE sur les rattachements seulement");

    let piece_apres: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents WHERE id = $1")
        .bind(piece_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(piece_apres, 1, "retrait intercalaire laisse la piece metier");
}
