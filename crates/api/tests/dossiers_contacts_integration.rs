//! Dossiers et contacts : type, étape, rôles, lien réciproque, historique, conflit, F8.
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

#[tokio::test]
async fn dossier_contact_lien_historique_conflit() {
    ensure_test_env();
    require_database_url();
    let (app, pool) = test_app().await;
    let token_a = access_token(&app, "dossiers-contacts-poste-a").await;
    let token_b = access_token(&app, "dossiers-contacts-poste-b").await;

    let dossier_a = Uuid::now_v7();
    let (st, cree) = json_auth(
        &app,
        "POST",
        "/dossiers",
        &token_a,
        json!({
            "id": dossier_a,
            "idempotence_cle": format!("dc-a-{dossier_a}"),
            "nom": "Dossier contacts A",
            "chemise": "kraft",
            "juridiction": "TJ Nanterre",
            "numero_rg": "26/10001",
            "restreint": false,
            "type_dossier": "contentieux",
            "etape": "instruction"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{cree:?}");

    let (type_dossier, etape, juridiction, rg): (String, String, String, String) = sqlx::query_as(
        "SELECT type_dossier, etape, juridiction, numero_rg FROM dossiers WHERE id = $1",
    )
    .bind(dossier_a)
    .fetch_one(&pool)
    .await
    .expect("dossier");
    assert_eq!(type_dossier, "contentieux");
    assert_eq!(etape, "instruction");
    assert_eq!(juridiction, "TJ Nanterre");
    assert_eq!(rg, "26/10001");

    let dossier_b = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/dossiers",
        &token_a,
        json!({
            "id": dossier_b,
            "idempotence_cle": format!("dc-b-{dossier_b}"),
            "nom": "Dossier contacts B",
            "chemise": "bleu-classeur",
            "juridiction": "CA Versailles",
            "numero_rg": "26/10002",
            "restreint": false
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let dossier_r = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/dossiers",
        &token_a,
        json!({
            "id": dossier_r,
            "idempotence_cle": format!("dc-r-{dossier_r}"),
            "nom": "Dossier restreint",
            "chemise": "gris-perle",
            "juridiction": "TJ Paris",
            "numero_rg": "26/10003",
            "restreint": true
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let (st, refuse) = json_auth(
        &app,
        "POST",
        "/contacts",
        &token_a,
        json!({
            "id": Uuid::now_v7(),
            "idempotence_cle": format!("dc-mauvais-{dossier_a}"),
            "nature": "morale",
            "nom": "Mauvais type",
            "type_client": "chorus"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refuse:?}");

    let contact_id = Uuid::now_v7();
    let (st, contact) = json_auth(
        &app,
        "POST",
        "/contacts",
        &token_a,
        json!({
            "id": contact_id,
            "idempotence_cle": format!("dc-c-{contact_id}"),
            "nature": "morale",
            "nom": "Societe Fictive",
            "siren": "123456789",
            "numero_tva": "FR00123456789",
            "type_client": "professionnel"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{contact:?}");
    assert_eq!(contact["type_client"], "professionnel");
    assert_eq!(contact["siren"], "123456789");

    let contact_phys = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/contacts",
        &token_a,
        json!({
            "id": contact_phys,
            "idempotence_cle": format!("dc-p-{contact_phys}"),
            "nature": "physique",
            "nom": "Camille Martin",
            "type_client": "particulier"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let contact_etr = Uuid::now_v7();
    let (st, etr) = json_auth(
        &app,
        "POST",
        "/contacts",
        &token_a,
        json!({
            "id": contact_etr,
            "idempotence_cle": format!("dc-e-{contact_etr}"),
            "nature": "morale",
            "nom": "Foreign Counsel",
            "type_client": "etranger"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{etr:?}");

    for (role, nom, cid) in [
        ("client", "Societe Fictive", Some(contact_id)),
        ("adversaire", "Partie adverse", None),
        ("confrere", "Confrere adverse", Some(contact_phys)),
    ] {
        let partie_id = Uuid::now_v7();
        let (st, partie) = json_auth(
            &app,
            "POST",
            &format!("/dossiers/{dossier_a}/parties"),
            &token_a,
            json!({
                "id": partie_id,
                "idempotence_cle": format!("dc-partie-{partie_id}"),
                "role": role,
                "nom": nom,
                "contact_id": cid
            }),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{role} {partie:?}");
    }

    let roles: Vec<String> =
        sqlx::query_scalar("SELECT role FROM parties WHERE dossier_id = $1 ORDER BY role")
            .bind(dossier_a)
            .fetch_all(&pool)
            .await
            .expect("roles");
    assert_eq!(
        roles,
        vec![
            "adversaire".to_string(),
            "client".to_string(),
            "confrere".to_string()
        ]
    );

    let (st, lien) = json_auth(
        &app,
        "POST",
        &format!("/dossiers/{dossier_a}/liens"),
        &token_a,
        json!({
            "id": Uuid::now_v7(),
            "idempotence_cle": format!("dc-lien-{dossier_a}-{dossier_b}"),
            "lie_a_id": dossier_b
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{lien:?}");
    let sens: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM dossier_liens
        WHERE (dossier_id = $1 AND lie_a_id = $2) OR (dossier_id = $2 AND lie_a_id = $1)
        "#,
    )
    .bind(dossier_a)
    .bind(dossier_b)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(sens, 2, "lien dans les deux sens");

    let (st, lien_r) = json_auth(
        &app,
        "POST",
        &format!("/dossiers/{dossier_a}/liens"),
        &token_a,
        json!({
            "id": Uuid::now_v7(),
            "idempotence_cle": format!("dc-lien-r-{dossier_r}"),
            "lie_a_id": dossier_r
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{lien_r:?}");
    let (vis, lie_r): (String, bool) = sqlx::query_as(
        "SELECT visibilite, lie_restreint FROM dossier_liens WHERE dossier_id = $1 AND lie_a_id = $2",
    )
    .bind(dossier_a)
    .bind(dossier_r)
    .fetch_one(&pool)
    .await
    .expect("lien restreint");
    assert_eq!(vis, "restreint");
    assert!(lie_r);

    let (st, histo) = json_auth(
        &app,
        "GET",
        &format!("/contacts/{contact_id}/historique"),
        &token_a,
        json!({}),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{histo:?}");
    let lignes = histo.as_array().expect("historique");
    assert!(
        lignes
            .iter()
            .any(|l| l["champ"] == "role" && l["valeur_appliquee"] == "client"),
        "{lignes:?}"
    );

    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/contacts/{contact_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": format!("dc-nom-a-{contact_id}"),
            "nom": "Societe Fictive A"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/contacts/{contact_id}"),
        &token_b,
        json!({
            "base_revision": 1,
            "idempotence_cle": format!("dc-nom-b-{contact_id}"),
            "nom": "Societe Fictive B"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (val, conflit, dossier_journal): (String, bool, Option<Uuid>) = sqlx::query_as(
        r#"
        SELECT valeur_appliquee, conflit, dossier_id FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'nom' AND table_cible = 'contacts'
        ORDER BY revision_appliquee DESC LIMIT 1
        "#,
    )
    .bind(contact_id)
    .fetch_one(&pool)
    .await
    .expect("journal contact");
    assert_eq!(val, "Societe Fictive B");
    assert!(conflit);
    assert!(dossier_journal.is_none());

    let (st, detail) = json_auth(
        &app,
        "PATCH",
        &format!("/dossiers/{dossier_a}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": format!("dc-etape-{dossier_a}"),
            "etape": "plaidoirie"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{detail:?}");
    assert_eq!(detail["etape"], "plaidoirie");
    assert_eq!(detail["type_dossier"], "contentieux");

    let (def_contact, def_facture): (String, String) = sqlx::query_as(
        r#"
        SELECT
            (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'contacts_type_client_check'),
            (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'factures_type_client_check')
        "#,
    )
    .fetch_one(&pool)
    .await
    .expect("contraintes F8");
    for mot in ["professionnel", "particulier", "etranger"] {
        assert!(def_contact.contains(mot), "{def_contact}");
        assert!(def_facture.contains(mot), "{def_facture}");
    }
}
