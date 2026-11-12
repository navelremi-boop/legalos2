//! Écritures de l'annuaire depuis le poste (file d'envoi PowerSync) : liens, fiche + lien dans la même
//! opération, notes. Postgres réel, essais négatifs compris. Nécessite `DATABASE_URL`.
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

use support::demo_seed::{
    DEMO_CABINET_ID, DEMO_EMAIL, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32, DEMO_USER_ID,
};

const EMAIL_B: &str = "julien.marchal@cabinet-fictif.example";
const USER_B_ID: &str = "01950000-0000-7000-8000-000000000042";

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

fn uuid_fixe(valeur: &str) -> Uuid {
    Uuid::parse_str(valeur).expect("uuid")
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
    seed_comptes(&pool).await;
    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    (build_router(state), pool)
}

async fn seed_comptes(pool: &sqlx::PgPool) {
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
    .bind(uuid_fixe(DEMO_CABINET_ID))
    .execute(pool)
    .await
    .expect("cabinet");
    for (id, email) in [(DEMO_USER_ID, DEMO_EMAIL), (USER_B_ID, EMAIL_B)] {
        sqlx::query(
            r#"
            INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif)
            VALUES ($1, $2, $3, $4, $5, TRUE)
            ON CONFLICT (id) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                totp_secret_chiffre = EXCLUDED.totp_secret_chiffre
            "#,
        )
        .bind(uuid_fixe(id))
        .bind(uuid_fixe(DEMO_CABINET_ID))
        .bind(email)
        .bind(&hash)
        .bind(&totp)
        .execute(pool)
        .await
        .expect("utilisateur");
    }
    sqlx::query("SELECT pg_advisory_unlock(8042004)")
        .execute(pool)
        .await
        .expect("deverrouillage");
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

fn code_totp() -> String {
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

async fn access_token(app: &axum::Router, email: &str, nom_appareil: &str) -> String {
    let connexion = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/connexion")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "email": email,
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
                    json!({ "session_token": session, "code_totp": code_totp() }).to_string(),
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

/// Crée un contact par l'API, avec l'identifiant choisi par le poste.
async fn creer_contact(
    app: &axum::Router,
    token: &str,
    nature: &str,
    nom: &str,
    serie: Uuid,
) -> Uuid {
    let id = Uuid::now_v7();
    let (st, corps) = json_auth(
        app,
        "POST",
        "/contacts",
        token,
        json!({
            "id": id,
            "idempotence_cle": format!("{serie}-contact-{id}"),
            "nature": nature,
            "nom": nom,
            "type_client": "professionnel"
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{corps:?}");
    id
}

fn fusionner(mut base: Value, ajout: Value) -> Value {
    if let (Some(b), Some(a)) = (base.as_object_mut(), ajout.as_object()) {
        for (cle, valeur) in a {
            b.insert(cle.clone(), valeur.clone());
        }
    }
    base
}

fn corps_lien(id: Uuid, serie: Uuid, cible: Uuid, extra: Value) -> Value {
    fusionner(
        json!({
            "id": id,
            "idempotence_cle": format!("{serie}-lien-{id}"),
            "contact_cible_id": cible,
            "type_lien": "mandat_social",
            "fonction": "president",
            "represente_societe": true,
            "debut": "2020-01-01"
        }),
        extra,
    )
}

fn corps_patch(serie: Uuid, base: i64, cle: &str, champs: Value) -> Value {
    fusionner(
        json!({ "base_revision": base, "idempotence_cle": format!("{serie}-{cle}") }),
        champs,
    )
}

async fn nombre_liens(pool: &sqlx::PgPool, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM contact_liens WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Cabinet étranger avec un contact, un lien et une note (rien ne doit en être visible ni modifiable).
async fn cabinet_etranger(pool: &sqlx::PgPool) -> (Uuid, Uuid, Uuid, Uuid) {
    let cabinet = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Autre cabinet', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("autre-{cabinet}"))
    .execute(pool)
    .await
    .unwrap();
    let (c1, c2, lien, note) = (
        Uuid::now_v7(),
        Uuid::now_v7(),
        Uuid::now_v7(),
        Uuid::now_v7(),
    );
    for (id, nature) in [(c1, "physique"), (c2, "morale")] {
        sqlx::query(
            "INSERT INTO contacts (id, cabinet_id, nature, nom, type_client, revision) VALUES ($1, $2, $3, 'Etranger', 'professionnel', 1)",
        )
        .bind(id)
        .bind(cabinet)
        .bind(nature)
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO contact_liens (id, cabinet_id, contact_source_id, contact_cible_id, type_lien, libelle) VALUES ($1, $2, $3, $4, 'autre', 'x')",
    )
    .bind(lien)
    .bind(cabinet)
    .bind(c1)
    .bind(c2)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO contact_notes (id, cabinet_id, contact_id, texte) VALUES ($1, $2, $3, 'secret')",
    )
    .bind(note)
    .bind(cabinet)
    .bind(c1)
    .execute(pool)
    .await
    .unwrap();
    (c1, c2, lien, note)
}

#[tokio::test]
async fn liens_modification_idempotente_et_controles_refaits_cote_api() {
    let (app, pool) = test_app().await;
    let token_a = access_token(&app, DEMO_EMAIL, "ecritures-liens-a").await;
    let token_b = access_token(&app, DEMO_EMAIL, "ecritures-liens-b").await;
    let serie = Uuid::now_v7();
    let societe = creer_contact(&app, &token_a, "morale", "Société Alpha fictive", serie).await;
    let p1 = creer_contact(&app, &token_a, "physique", "Personne Un fictive", serie).await;
    let p2 = creer_contact(&app, &token_a, "physique", "Personne Deux fictive", serie).await;
    let route_p1 = format!("/contacts/{p1}/liens");
    let route_p2 = format!("/contacts/{p2}/liens");

    // Création avec l'id du poste ; rejeu par clé, puis par id sous une autre clé : aucun doublon.
    let l1 = Uuid::now_v7();
    let corps = corps_lien(l1, serie, societe, json!({}));
    let (st, lien) = json_auth(&app, "POST", &route_p1, &token_a, corps.clone()).await;
    assert_eq!(st, StatusCode::OK, "{lien:?}");
    assert_eq!(lien["id"], l1.to_string());
    assert_eq!(lien["revision"], 1);
    let (st, rejeu) = json_auth(&app, "POST", &route_p1, &token_a, corps).await;
    assert_eq!(st, StatusCode::OK, "{rejeu:?}");
    let autre_cle = corps_lien(
        l1,
        serie,
        societe,
        json!({ "idempotence_cle": format!("{serie}-autre-cle") }),
    );
    let (st, rejeu) = json_auth(&app, "POST", &route_p1, &token_a, autre_cle).await;
    assert_eq!(st, StatusCode::OK, "{rejeu:?}");
    assert_eq!(nombre_liens(&pool, l1).await, 1, "rejeu sans effet");

    // Essais négatifs de création : deuxième représentant, mandat vers une personne physique, date.
    let (st, refus) = json_auth(
        &app,
        "POST",
        &route_p2,
        &token_a,
        corps_lien(Uuid::now_v7(), serie, societe, json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refus:?}");
    let (st, refus) = json_auth(
        &app,
        "POST",
        &route_p1,
        &token_a,
        corps_lien(Uuid::now_v7(), serie, p2, json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refus:?}");
    let (st, refus) = json_auth(
        &app,
        "POST",
        &route_p1,
        &token_a,
        corps_lien(
            Uuid::now_v7(),
            serie,
            societe,
            json!({ "debut": "1er mars 2020", "represente_societe": false }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "date hors format : {refus:?}");

    // Un second lien, non représentant, pour la même fonction.
    let l2 = Uuid::now_v7();
    let (st, lien2) = json_auth(
        &app,
        "POST",
        &route_p2,
        &token_a,
        corps_lien(l2, serie, societe, json!({ "represente_societe": false })),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{lien2:?}");

    // Modification : deuxième représentant refusé, rien ne change.
    let (st, refus) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-liens/{l2}"),
        &token_a,
        corps_patch(serie, 1, "l2-repr", json!({ "represente_societe": true })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refus:?}");
    let revision_l2: i64 = sqlx::query_scalar("SELECT revision FROM contact_liens WHERE id = $1")
        .bind(l2)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(revision_l2, 1, "un refus ne change rien");

    // Fin avant le début, ou égale au début : refusée. Début retiré avec une fin : refusé.
    for fin in ["2019-01-01", "2020-01-01"] {
        let (st, refus) = json_auth(
            &app,
            "PATCH",
            &format!("/contact-liens/{l1}"),
            &token_a,
            corps_patch(serie, 1, &format!("l1-fin-{fin}"), json!({ "fin": fin })),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "fin {fin} : {refus:?}");
    }
    let (st, refus) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-liens/{l1}"),
        &token_a,
        corps_patch(
            serie,
            1,
            "l1-sans-debut",
            json!({ "debut": null, "fin": "2024-06-30" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refus:?}");

    // Pose de la fin : révision 2 ; rejeu (même clé, autre clé) sans effet.
    let (st, fin_posee) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-liens/{l1}"),
        &token_a,
        corps_patch(
            serie,
            1,
            "l1-fin-ok",
            json!({ "fin": "2024-06-30", "contact_cible_id": Uuid::now_v7() }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{fin_posee:?}");
    assert_eq!(fin_posee["revision"], 2);
    assert_eq!(
        fin_posee["contact_cible_id"],
        societe.to_string(),
        "la cible ne change pas"
    );
    for cle in ["l1-fin-ok", "l1-fin-ok-bis"] {
        let (st, rejeu) = json_auth(
            &app,
            "PATCH",
            &format!("/contact-liens/{l1}"),
            &token_a,
            corps_patch(serie, 1, cle, json!({ "fin": "2024-06-30" })),
        )
        .await;
        assert_eq!(st, StatusCode::OK, "{rejeu:?}");
        assert_eq!(rejeu["revision"], 2, "rejeu sans effet ({cle})");
    }
    let journal: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM journal_modifications WHERE enregistrement_id = $1 AND table_cible = 'contact_liens' AND champ = 'fin'",
    )
    .bind(l1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(journal, 1, "une seule entrée de journal pour la fin");

    // Le mandat de l1 est clos : l2 peut devenir le représentant ; rouvrir l1 est alors refusé.
    let (st, ok) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-liens/{l2}"),
        &token_a,
        corps_patch(
            serie,
            1,
            "l2-repr-ok",
            json!({ "represente_societe": true }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{ok:?}");
    assert_eq!(ok["revision"], 2);
    let (st, refus) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-liens/{l1}"),
        &token_a,
        corps_patch(serie, 2, "l1-rouvre", json!({ "fin": null })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "deux mandats en cours : {refus:?}"
    );

    // Mandat vers une personne physique : refusé par changement de type.
    let l3 = Uuid::now_v7();
    let (st, lien3) = json_auth(
        &app,
        "POST",
        &route_p1,
        &token_a,
        corps_lien(
            l3,
            serie,
            p2,
            json!({ "type_lien": "salarie", "fonction": null, "represente_societe": false }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{lien3:?}");
    let route_l3 = format!("/contact-liens/{l3}");
    let (st, refus) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_a,
        corps_patch(
            serie,
            1,
            "l3-mandat",
            json!({ "type_lien": "mandat_social", "fonction": "gerant" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refus:?}");

    // Effacement par null ; champ absent inchangé.
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_a,
        corps_patch(
            serie,
            1,
            "l3-note",
            json!({ "note": "Dirigeant depuis le registre", "source": "registre" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_a,
        corps_patch(serie, 2, "l3-efface", json!({ "note": null })),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (note, source): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT note, source FROM contact_liens WHERE id = $1")
            .bind(l3)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(note, None);
    assert_eq!(source.as_deref(), Some("registre"));

    // Corps vide, clé vide, lien inconnu, version future, lien d'un autre cabinet : refusés.
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_a,
        corps_patch(serie, 3, "vide", json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_a,
        json!({ "base_revision": 3, "idempotence_cle": " ", "note": "x" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-liens/{}", Uuid::now_v7()),
        &token_a,
        corps_patch(serie, 1, "inconnu", json!({ "note": "x" })),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_a,
        corps_patch(serie, 99, "base-future", json!({ "note": "x" })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "version de base postérieure au serveur"
    );
    let (_, _, lien_etranger, _) = cabinet_etranger(&pool).await;
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-liens/{lien_etranger}"),
        &token_a,
        corps_patch(serie, 1, "autre-cabinet", json!({ "note": "x" })),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND, "lien d'un autre cabinet");

    // Autre poste, base périmée : la dernière écriture gagne, le conflit est journalisé.
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_b,
        corps_patch(
            serie,
            1,
            "l3-libelle-b",
            json!({ "libelle": "Écrit depuis B" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_l3,
        &token_a,
        corps_patch(
            serie,
            1,
            "l3-libelle-a",
            json!({ "libelle": "Écrit depuis A" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let libelle: Option<String> =
        sqlx::query_scalar("SELECT libelle FROM contact_liens WHERE id = $1")
            .bind(l3)
            .fetch_one(&pool)
            .await
            .unwrap();
    let conflit: bool = sqlx::query_scalar(
        "SELECT bool_or(conflit) FROM journal_modifications WHERE enregistrement_id = $1 AND champ = 'libelle'",
    )
    .bind(l3)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(libelle.as_deref(), Some("Écrit depuis A"));
    assert!(conflit, "conflit journalisé");
}

#[tokio::test]
async fn fiche_dirigeant_puis_lien_dans_la_meme_operation() {
    let (app, pool) = test_app().await;
    let token = access_token(&app, DEMO_EMAIL, "ecritures-fiche-lien").await;
    let serie = Uuid::now_v7();
    let societe = creer_contact(&app, &token, "morale", "Société Beta fictive", serie).await;

    // Le poste écrit la fiche (id client) puis le lien, dans cet ordre, sans attendre.
    let dirigeant = Uuid::now_v7();
    let corps_fiche = json!({
        "id": dirigeant,
        "idempotence_cle": format!("{dirigeant}:contacts:put"),
        "nature": "physique",
        "nom": "Dirigeant fictif",
        "prenoms": "Camille",
        "civilite": "Madame",
        "type_client": "particulier"
    });
    let (st, fiche) = json_auth(&app, "POST", "/contacts", &token, corps_fiche.clone()).await;
    assert_eq!(st, StatusCode::OK, "{fiche:?}");
    let lien = Uuid::now_v7();
    let (st, cree) = json_auth(
        &app,
        "POST",
        &format!("/contacts/{dirigeant}/liens"),
        &token,
        corps_lien(
            lien,
            serie,
            societe,
            json!({ "idempotence_cle": format!("{lien}:contact_liens:put") }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{cree:?}");

    // Rejeu de la fiche : même clé, puis autre clé et même id ; une seule ligne, même révision.
    for cle in [
        format!("{dirigeant}:contacts:put"),
        "autre-cle-de-rejeu".to_string(),
    ] {
        let mut corps = corps_fiche.clone();
        corps["idempotence_cle"] = json!(cle);
        corps["nom"] = json!("Nom différent ignoré au rejeu");
        let (st, rejeu) = json_auth(&app, "POST", "/contacts", &token, corps).await;
        assert_eq!(st, StatusCode::OK, "{rejeu:?}");
        assert_eq!(rejeu["revision"], 1);
        assert_eq!(rejeu["nom"], "Dirigeant fictif");
    }
    let lignes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM contacts WHERE id = $1")
        .bind(dirigeant)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(lignes, 1);

    // Un identifiant qui appartient à un autre cabinet n'est ni rendu ni écrasé.
    let (etranger, _, _, _) = cabinet_etranger(&pool).await;
    let mut corps = corps_fiche;
    corps["id"] = json!(etranger);
    corps["idempotence_cle"] = json!(format!("{serie}-id-etranger"));
    let (st, _) = json_auth(&app, "POST", "/contacts", &token, corps).await;
    assert_eq!(st, StatusCode::CONFLICT);

    // Deux contacts distincts ne partagent pas une adresse e-mail : refus lisible, sans l'adresse.
    let email = format!("partage-{serie}@exemple.test");
    let premier = Uuid::now_v7();
    let (st, corps_ok) = json_auth(
        &app,
        "POST",
        "/contacts",
        &token,
        json!({
            "id": premier,
            "idempotence_cle": format!("{serie}-email-1"),
            "nature": "physique",
            "nom": "Premier porteur fictif",
            "type_client": "particulier",
            "email": email
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{corps_ok:?}");
    let second = Uuid::now_v7();
    let (st, refus) = json_auth(
        &app,
        "POST",
        "/contacts",
        &token,
        json!({
            "id": second,
            "idempotence_cle": format!("{serie}-email-2"),
            "nature": "physique",
            "nom": "Second porteur fictif",
            "type_client": "particulier",
            "email": email.to_uppercase()
        }),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT, "{refus:?}");
    let message = refus["message"].as_str().expect("message");
    assert!(message.contains("adresse e-mail"), "{message}");
    assert!(
        !refus.to_string().to_lowercase().contains(&email),
        "aucune adresse dans l'erreur"
    );
    assert!(
        !refus.to_string().contains("contacts_cabinet_email_unique"),
        "aucun détail interne"
    );
    let cree: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM contacts WHERE id = $1")
        .bind(second)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cree, 0, "le refus ne crée rien");
}

#[tokio::test]
async fn notes_auteur_pose_par_le_serveur_modification_et_rejeu() {
    let (app, pool) = test_app().await;
    let token_a = access_token(&app, DEMO_EMAIL, "ecritures-notes-a").await;
    let token_b = access_token(&app, EMAIL_B, "ecritures-notes-b").await;
    let serie = Uuid::now_v7();
    let contact = creer_contact(&app, &token_a, "physique", "Fiche aux notes fictive", serie).await;
    let autre_contact =
        creer_contact(&app, &token_a, "physique", "Autre fiche fictive", serie).await;
    let route_notes = format!("/contacts/{contact}/notes");

    // L'auteur ne se pose pas depuis le corps.
    let note = Uuid::now_v7();
    let faux_auteur = Uuid::now_v7();
    let corps = json!({
        "id": note,
        "idempotence_cle": format!("{serie}-note"),
        "texte": "  Première note fictive  ",
        "auteur_id": faux_auteur,
        "auteur_libelle": "Me Faux Auteur",
        "modifie_le": "1999-01-01T00:00:00Z"
    });
    let (st, creee) = json_auth(&app, "POST", &route_notes, &token_a, corps.clone()).await;
    assert_eq!(st, StatusCode::OK, "{creee:?}");
    assert_eq!(creee["texte"], "Première note fictive");
    assert_eq!(creee["auteur_id"], DEMO_USER_ID);
    assert!(
        creee.get("auteur_libelle").is_none(),
        "le serveur ne calcule plus de libellé : le poste le compose depuis l'identité"
    );
    assert_eq!(creee["revision"], 1);
    let (auteur, libelle, cree, modifie): (Option<Uuid>, Option<String>, String, String) =
        sqlx::query_as(
            "SELECT auteur_id, auteur_libelle, cree_le::text, modifie_le::text FROM contact_notes WHERE id = $1",
        )
        .bind(note)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(auteur, Some(uuid_fixe(DEMO_USER_ID)));
    assert_eq!(libelle, None, "auteur_libelle n'est plus écrit");
    assert_eq!(cree, modifie, "modifie_le = cree_le à la création");

    // Rejeu par clé, puis par identifiant sous une autre clé et un autre utilisateur : rien ne change.
    let mut autre_cle = corps.clone();
    autre_cle["idempotence_cle"] = json!(format!("{serie}-note-bis"));
    autre_cle["texte"] = json!("Texte ignoré au rejeu");
    for rejeu in [corps, autre_cle] {
        let (st, r) = json_auth(&app, "POST", &route_notes, &token_b, rejeu).await;
        assert_eq!(st, StatusCode::OK, "{r:?}");
        assert_eq!(r["texte"], "Première note fictive");
        assert_eq!(
            r["auteur_id"], DEMO_USER_ID,
            "un rejeu ne change pas l'auteur"
        );
    }
    let lignes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM contact_notes WHERE id = $1")
        .bind(note)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(lignes, 1);

    // Refus : texte vide, contact inconnu, identifiant déjà pris par la note d'une autre fiche.
    let (st, _) = json_auth(
        &app,
        "POST",
        &route_notes,
        &token_a,
        json!({ "id": Uuid::now_v7(), "idempotence_cle": format!("{serie}-vide"), "texte": "  \n " }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, _) = json_auth(
        &app,
        "POST",
        &format!("/contacts/{}/notes", Uuid::now_v7()),
        &token_a,
        json!({ "id": Uuid::now_v7(), "idempotence_cle": format!("{serie}-inconnu"), "texte": "x" }),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = json_auth(
        &app,
        "POST",
        &format!("/contacts/{autre_contact}/notes"),
        &token_a,
        json!({ "id": note, "idempotence_cle": format!("{serie}-id-pris"), "texte": "x" }),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);

    // Modification par un autre utilisateur : texte, auteur, libellé, modifie_le, révision changent.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let route_note = format!("/contact-notes/{note}");
    let patch = corps_patch(
        serie,
        1,
        "patch",
        json!({ "texte": "Note corrigée", "auteur_id": faux_auteur }),
    );
    let (st, modifiee) = json_auth(&app, "PATCH", &route_note, &token_b, patch.clone()).await;
    assert_eq!(st, StatusCode::OK, "{modifiee:?}");
    assert_eq!(modifiee["texte"], "Note corrigée");
    assert_eq!(modifiee["revision"], 2);
    assert_eq!(modifiee["auteur_id"], USER_B_ID);
    assert!(modifiee.get("auteur_libelle").is_none());
    assert_eq!(
        modifiee["cree_le"], creee["cree_le"],
        "cree_le ne bouge pas"
    );
    assert_ne!(modifiee["modifie_le"], creee["modifie_le"]);

    // Rejeu (même clé, autre clé et même texte) : sans effet, y compris pour l'auteur.
    let autre = fusionner(
        patch.clone(),
        json!({ "idempotence_cle": format!("{serie}-patch-bis") }),
    );
    for rejeu in [patch, autre] {
        let (st, r) = json_auth(&app, "PATCH", &route_note, &token_a, rejeu).await;
        assert_eq!(st, StatusCode::OK, "{r:?}");
        assert_eq!(r["revision"], 2);
        assert_eq!(r["auteur_id"], USER_B_ID);
        assert_eq!(r["modifie_le"], modifiee["modifie_le"]);
    }

    // Essais négatifs : texte vide, absent, version de base, note inconnue ou d'un autre cabinet.
    for (cle, corps) in [
        ("vide", json!({ "base_revision": 2, "texte": "   " })),
        ("absent", json!({ "base_revision": 2 })),
        ("future", json!({ "base_revision": 9, "texte": "x" })),
    ] {
        let corps = fusionner(
            corps,
            json!({ "idempotence_cle": format!("{serie}-{cle}") }),
        );
        let (st, _) = json_auth(&app, "PATCH", &route_note, &token_a, corps).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{cle}");
    }
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-notes/{}", Uuid::now_v7()),
        &token_a,
        corps_patch(serie, 1, "introuvable", json!({ "texte": "x" })),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (contact_etranger, _, _, note_etrangere) = cabinet_etranger(&pool).await;
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/contact-notes/{note_etrangere}"),
        &token_a,
        corps_patch(serie, 1, "autre-cab", json!({ "texte": "x" })),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = json_auth(
        &app,
        "POST",
        &format!("/contacts/{contact_etranger}/notes"),
        &token_a,
        json!({ "id": Uuid::now_v7(), "idempotence_cle": format!("{serie}-contact-autre-cab"), "texte": "x" }),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}
