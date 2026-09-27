//! Conflits généralisés (docs/conflits.md) contre Postgres réel. Nécessite `DATABASE_URL`.
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
        .expect("DATABASE_URL requis pour conflits_integration (Postgres réel)");
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
    sqlx::query("SELECT pg_advisory_lock(8042004)")
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
    sqlx::query("SELECT pg_advisory_unlock(8042004)")
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
async fn conflits_par_table_et_immuabilite() {
    ensure_test_env();
    require_database_url();
    let (app, pool) = test_app().await;
    let cabinet_id = uuid_recette(DEMO_CABINET_ID);
    let token_a = access_token(&app, "conflits-poste-a").await;
    let token_b = access_token(&app, "conflits-poste-b").await;

    let dossier_id = Uuid::now_v7();
    let (st, dossier) = json_auth(
        &app,
        "POST",
        "/dossiers",
        &token_a,
        json!({
            "id": dossier_id,
            "idempotence_cle": format!("creer-d-{dossier_id}"),
            "nom": "Dossier conflits",
            "chemise": "kraft",
            "juridiction": "TJ Nanterre",
            "numero_rg": "26/00001",
            "restreint": false
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{dossier:?}");

    // --- Dossier : dernière écriture gagnante + journal + conflit autre poste ---
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/dossiers/{dossier_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": "d-nom-a1",
            "nom": "Nom A"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/dossiers/{dossier_id}"),
        &token_b,
        json!({
            "base_revision": 1,
            "idempotence_cle": "d-nom-b1",
            "nom": "Nom B"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let j = sqlx::query_as::<_, (String, bool, Option<Uuid>)>(
        r#"
        SELECT valeur_appliquee, conflit, dossier_id
        FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'nom'
        ORDER BY revision_appliquee DESC
        LIMIT 1
        "#,
    )
    .bind(dossier_id)
    .fetch_one(&pool)
    .await
    .expect("journal dossier");
    assert_eq!(j.0, "Nom B");
    assert!(j.1, "conflit attendu entre deux postes");
    assert_eq!(j.2, Some(dossier_id));

    let rev: i64 = sqlx::query_scalar("SELECT revision FROM dossiers WHERE id = $1")
        .bind(dossier_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    // Même poste après reprise : pas un conflit
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/dossiers/{dossier_id}"),
        &token_b,
        json!({
            "base_revision": rev,
            "idempotence_cle": "d-nom-b2",
            "nom": "Nom B2"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let conflit_meme_poste: bool = sqlx::query_scalar(
        r#"
        SELECT conflit FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'nom' AND valeur_appliquee = 'Nom B2'
        "#,
    )
    .bind(dossier_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!conflit_meme_poste);

    // Rejeu idempotent
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/dossiers/{dossier_id}"),
        &token_b,
        json!({
            "base_revision": rev,
            "idempotence_cle": "d-nom-b2",
            "nom": "Nom B2"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let count_b2: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM journal_modifications
        WHERE enregistrement_id = $1 AND valeur_appliquee = 'Nom B2'
        "#,
    )
    .bind(dossier_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count_b2, 1);

    // --- Partie ---
    let partie_id = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        &format!("/dossiers/{dossier_id}/parties"),
        &token_a,
        json!({
            "id": partie_id,
            "idempotence_cle": format!("creer-p-{partie_id}"),
            "role": "client",
            "nom": "Client A"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/parties/{partie_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": "p-nom-a",
            "nom": "Client A bis"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/parties/{partie_id}"),
        &token_b,
        json!({
            "base_revision": 1,
            "idempotence_cle": "p-nom-b",
            "nom": "Client B"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (val, conflit, d_id): (String, bool, Option<Uuid>) = sqlx::query_as(
        r#"
        SELECT valeur_appliquee, conflit, dossier_id FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'nom'
        ORDER BY revision_appliquee DESC LIMIT 1
        "#,
    )
    .bind(partie_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(val, "Client B");
    assert!(conflit);
    assert_eq!(d_id, Some(dossier_id));

    // --- Temps + brouillon + taux ---
    let temps_id = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/temps",
        &token_a,
        json!({
            "id": temps_id,
            "dossier_id": dossier_id,
            "minutes": 60,
            "libelle": "Audience",
            "taux_centimes_heure": 20000,
            "idempotence_cle": format!("creer-t-{temps_id}")
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/temps/{temps_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": "t-lib-a",
            "libelle": "Audience A"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/temps/{temps_id}"),
        &token_b,
        json!({
            "base_revision": 1,
            "idempotence_cle": "t-lib-b",
            "libelle": "Audience B"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let conflit_temps: bool = sqlx::query_scalar(
        r#"
        SELECT conflit FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'libelle'
        ORDER BY revision_appliquee DESC LIMIT 1
        "#,
    )
    .bind(temps_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(conflit_temps);

    let brouillon_id = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/brouillons-facture",
        &token_a,
        json!({
            "id": brouillon_id,
            "dossier_id": dossier_id,
            "temps_id": temps_id,
            "libelle": "Honoraires",
            "ht_centimes": 20000,
            "taux_centimes_heure": 20000,
            "idempotence_cle": format!("creer-br-{brouillon_id}")
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/brouillons-facture/{brouillon_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": "br-lib-a",
            "libelle": "Honoraires A"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/brouillons-facture/{brouillon_id}"),
        &token_b,
        json!({
            "base_revision": 1,
            "idempotence_cle": "br-lib-b",
            "libelle": "Honoraires B"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let conflit_br: bool = sqlx::query_scalar(
        r#"
        SELECT conflit FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'libelle'
        ORDER BY revision_appliquee DESC LIMIT 1
        "#,
    )
    .bind(brouillon_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(conflit_br);

    // Immuabilité : numéroter le brouillon puis refuser PATCH brouillon et temps
    sqlx::query("UPDATE brouillons_facture SET numero = 1 WHERE id = $1")
        .bind(brouillon_id)
        .execute(&pool)
        .await
        .unwrap();
    let (st, body) = json_auth(
        &app,
        "PATCH",
        &format!("/brouillons-facture/{brouillon_id}"),
        &token_a,
        json!({
            "base_revision": 3,
            "idempotence_cle": "br-immuable",
            "libelle": "Interdit"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "{body:?}");
    let (st, body) = json_auth(
        &app,
        "PATCH",
        &format!("/temps/{temps_id}"),
        &token_a,
        json!({
            "base_revision": 3,
            "idempotence_cle": "t-immuable",
            "libelle": "Interdit"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "{body:?}");

    // --- Taux cabinet (dossier_id nul au journal) ---
    let taux_id = Uuid::now_v7();
    let (st, _) = json_auth(
        &app,
        "POST",
        "/taux-horaires",
        &token_a,
        json!({
            "id": taux_id,
            "centimes_par_heure": 25000,
            "idempotence_cle": format!("creer-tx-{taux_id}")
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/taux-horaires/{taux_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": "tx-a",
            "centimes_par_heure": 26000
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/taux-horaires/{taux_id}"),
        &token_b,
        json!({
            "base_revision": 1,
            "idempotence_cle": "tx-b",
            "centimes_par_heure": 27000
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (val, conflit, d_id): (String, bool, Option<Uuid>) = sqlx::query_as(
        r#"
        SELECT valeur_appliquee, conflit, dossier_id FROM journal_modifications
        WHERE enregistrement_id = $1 AND champ = 'centimes_par_heure'
        ORDER BY revision_appliquee DESC LIMIT 1
        "#,
    )
    .bind(taux_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(val, "27000");
    assert!(conflit);
    assert!(d_id.is_none(), "taux cabinet : dossier_id nul");

    // CHECK restreint / visibilite
    let incoherent = sqlx::query(
        "UPDATE dossiers SET restreint = TRUE, visibilite = 'public' WHERE id = $1",
    )
    .bind(dossier_id)
    .execute(&pool)
    .await;
    assert!(
        incoherent.is_err(),
        "écriture incohérente restreint/visibilité doit être refusée"
    );

    // Journal cabinet (cabinets) : dossier_id nul — déjà couvert par patch cabinet existant ;
    // vérifier qu'une entrée cabinets a dossier_id nul après un PATCH.
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/cabinets/{cabinet_id}"),
        &token_a,
        json!({
            "base_revision": 1,
            "idempotence_cle": format!("cab-nom-{dossier_id}"),
            "nom": format!("Cabinet conflits {dossier_id}")
        }),
    )
    .await;
    // base_revision peut être > 1 si d'autres tests ont touché le cabinet : accepter 200 ou 400
    if st == StatusCode::OK {
        let d_id: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT dossier_id FROM journal_modifications
            WHERE table_cible = 'cabinets' AND enregistrement_id = $1
            ORDER BY revision_appliquee DESC LIMIT 1
            "#,
        )
        .bind(cabinet_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(d_id.is_none());
    } else {
        // Relire la révision et réessayer
        let cab_rev: i64 = sqlx::query_scalar("SELECT revision FROM cabinets WHERE id = $1")
            .bind(cabinet_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let (st2, _) = json_auth(
            &app,
            "PATCH",
            &format!("/cabinets/{cabinet_id}"),
            &token_a,
            json!({
                "base_revision": cab_rev,
                "idempotence_cle": format!("cab-nom2-{dossier_id}"),
                "nom": format!("Cabinet conflits {dossier_id}")
            }),
        )
        .await;
        assert_eq!(st2, StatusCode::OK);
        let d_id: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT dossier_id FROM journal_modifications
            WHERE table_cible = 'cabinets' AND enregistrement_id = $1
            ORDER BY revision_appliquee DESC LIMIT 1
            "#,
        )
        .bind(cabinet_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(d_id.is_none());
    }
}
