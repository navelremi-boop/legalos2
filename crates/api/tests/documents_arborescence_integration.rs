//! Arborescence documents + extraction texte + divergence (Postgres réel).
#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use legalos_api::build_app_state;
use legalos_api::build_router;
use legalos_api::config::Config;
use legalos_api::texte_document::extraire_texte;
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
        .expect("DATABASE_URL requis pour documents_arborescence_integration (Postgres réel)");
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
    sqlx::query("SELECT pg_advisory_lock(8042006)")
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
    sqlx::query("SELECT pg_advisory_unlock(8042006)")
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

/// Minimal docx (zip) contenant `Piece fictive dossier` dans word/document.xml.
fn fixture_docx() -> Vec<u8> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/recette/fixtures/piece-fictive.docx"),
    )
    .expect("fixture docx")
}

fn fixture_pdf_sans_texte() -> Vec<u8> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/recette/fixtures/sans-texte.pdf"),
    )
    .expect("fixture pdf")
}

#[tokio::test]
async fn arborescence_enfant_et_refus_cycle() {
    ensure_test_env();
    require_database_url();
    let (app, _pool) = test_app().await;
    let token = access_token(&app, "docs-arbo-poste").await;
    let dossier_id = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/dossiers",
        &token,
        json!({
            "id": dossier_id,
            "idempotence_cle": format!("creer-d-{dossier_id}"),
            "nom": "Dossier arborescence",
            "chemise": "kraft",
            "juridiction": "TJ Lyon",
            "numero_rg": "26/00901",
            "restreint": false
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let racine_id = Uuid::now_v7();
    let (st, racine) = json_auth(
        &app,
        "POST",
        "/repertoires",
        &token,
        json!({
            "id": racine_id,
            "dossier_id": dossier_id,
            "parent_id": null,
            "nom": "Pieces",
            "idempotence_cle": format!("rep-{racine_id}")
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{racine:?}");
    assert_eq!(racine["revision"], 1);

    let enfant_id = Uuid::now_v7();
    let (st, enfant) = json_auth(
        &app,
        "POST",
        "/repertoires",
        &token,
        json!({
            "id": enfant_id,
            "dossier_id": dossier_id,
            "parent_id": racine_id,
            "nom": "Courriers",
            "idempotence_cle": format!("rep-{enfant_id}")
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{enfant:?}");
    assert_eq!(enfant["parent_id"], json!(racine_id));

    // Cycle : parent de la racine = enfant.
    let (st, refus) = json_auth(
        &app,
        "PATCH",
        &format!("/repertoires/{racine_id}"),
        &token,
        json!({
            "base_revision": 1,
            "idempotence_cle": format!("cycle-{racine_id}"),
            "parent_id": enfant_id
        }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refus:?}");
}

#[tokio::test]
async fn divergence_deux_versions_meme_base() {
    ensure_test_env();
    require_database_url();
    let (app, pool) = test_app().await;
    let token = access_token(&app, "docs-div-poste").await;
    let dossier_id = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/dossiers",
        &token,
        json!({
            "id": dossier_id,
            "idempotence_cle": format!("creer-d-{dossier_id}"),
            "nom": "Dossier divergence",
            "chemise": "bleu-classeur",
            "juridiction": "TJ Paris",
            "numero_rg": "26/00902",
            "restreint": false
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let document_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO documents (id, cabinet_id, dossier_id, nom, visibilite, dossier_texte, revision)
        SELECT $1, $2, dossiers.id, 'note.docx', dossiers.visibilite, dossiers.id::text, 1
        FROM dossiers WHERE dossiers.id = $3
        "#,
    )
    .bind(document_id)
    .bind(uuid_recette(DEMO_CABINET_ID))
    .bind(dossier_id)
    .execute(&pool)
    .await
    .expect("document");

    let auteur = uuid_recette(support::demo_seed::DEMO_USER_ID);
    // Version 1 scellée (base).
    sqlx::query(
        r#"
        INSERT INTO document_versions (
            id, document_id, numero, empreinte, taille, auteur_id, cle_objet,
            cabinet_id, dossier_id, visibilite, dossier_texte, texte, parent_numero
        )
        SELECT $1, $2, 1, 'a', 1, $3, 'documents/' || $2::text || '/v1',
               cabinet_id, dossier_id, visibilite, dossier_texte, '', NULL
        FROM documents WHERE id = $2
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(document_id)
    .bind(auteur)
    .execute(&pool)
    .await
    .expect("v1");

    // Deux versions issues de la même base (parent_numero = 1), conservées.
    for numero in [2_i32, 3_i32] {
        sqlx::query(
            r#"
            INSERT INTO document_versions (
                id, document_id, numero, empreinte, taille, auteur_id, cle_objet,
                cabinet_id, dossier_id, visibilite, dossier_texte, texte, parent_numero
            )
            SELECT $1, $2, $3, $4, 1, $5, 'documents/' || $2::text || '/v' || $3::text,
                   cabinet_id, dossier_id, visibilite, dossier_texte, 'extrait', 1
            FROM documents WHERE id = $2
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(document_id)
        .bind(numero)
        .bind(format!("emp-{numero}"))
        .bind(auteur)
        .execute(&pool)
        .await
        .expect("branche");
    }

    let parents: Vec<(i32, Option<i32>)> = sqlx::query_as(
        "SELECT numero, parent_numero FROM document_versions WHERE document_id = $1 ORDER BY numero",
    )
    .bind(document_id)
    .fetch_all(&pool)
    .await
    .expect("lecture");
    assert_eq!(parents.len(), 3);
    assert_eq!(parents[1].1, Some(1));
    assert_eq!(parents[2].1, Some(1));

    let meme_parent: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM document_versions
        WHERE document_id = $1 AND parent_numero = 1
        "#,
    )
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .expect("count");
    assert_eq!(meme_parent, 2);
}

#[test]
fn extraction_texte_docx_et_pdf() {
    let docx = fixture_docx();
    let texte = extraire_texte("piece-fictive.docx", &docx);
    assert!(
        texte.contains("Piece fictive dossier"),
        "texte docx attendu, reçu {texte:?}"
    );

    let pdf = fixture_pdf_sans_texte();
    let vide = extraire_texte("sans-texte.pdf", &pdf);
    assert_eq!(vide, "", "pdf sans couche texte → chaîne vide");
}
