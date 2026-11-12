//! Identité des membres du cabinet : lecture et modification de son profil, modification par un
//! administrateur, flux de synchronisation. Postgres réel, essais négatifs compris.
//! Nécessite `DATABASE_URL`.
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

use support::demo_seed::{DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32};

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

fn code_totp() -> String {
    let secret = Secret::try_from_base32(DEMO_TOTP_SECRET_BASE32).expect("secret");
    let totp: Totp = Builder::new()
        .with_secret(secret.as_bytes().to_vec())
        .with_algorithm(Algorithm::SHA1)
        .with_account_name("identite@cabinet-fictif.example")
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
                    json!({ "email": email, "password": DEMO_PASSWORD, "nom_appareil": nom_appareil })
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

fn fusionner(mut base: Value, ajout: Value) -> Value {
    if let (Some(b), Some(a)) = (base.as_object_mut(), ajout.as_object()) {
        for (cle, valeur) in a {
            b.insert(cle.clone(), valeur.clone());
        }
    }
    base
}

fn patch(serie: Uuid, base: i64, cle: &str, champs: Value) -> Value {
    fusionner(
        json!({ "base_revision": base, "idempotence_cle": format!("{serie}-{cle}") }),
        champs,
    )
}

struct Cabinet {
    admin: (Uuid, String),
    membre: (Uuid, String),
    etranger: (Uuid, String),
}

/// Deux cabinets fictifs : un administrateur et un collaborateur dans le premier, un utilisateur dans le second.
/// Les adresses ressemblent à « prenom.nom » pour prouver qu'aucune identité n'en est déduite.
async fn creer_cabinets(pool: &sqlx::PgPool, serie: Uuid) -> Cabinet {
    let hash = legalos_api::auth::password::hash_password(DEMO_PASSWORD).expect("hash");
    let totp = legalos_api::auth::totp::chiffrer_secret_totp(
        DEMO_TOTP_SECRET_BASE32.as_bytes(),
        b"legalos_demo_chiffrement_32oct!!",
    )
    .expect("totp");
    let cabinet = Uuid::now_v7();
    let autre = Uuid::now_v7();
    for (id, nom) in [(cabinet, "Cabinet identité"), (autre, "Autre cabinet")] {
        sqlx::query(
            "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, $3, TRUE)",
        )
        .bind(id)
        .bind(format!("identite-{id}"))
        .bind(nom)
        .execute(pool)
        .await
        .expect("cabinet");
    }
    let mut ids = Vec::new();
    for (cab, local, role) in [
        (cabinet, "camille.dupont", "administrateur"),
        (cabinet, "julien.marchal", "collaborateur"),
        (autre, "etienne.leroy", "administrateur"),
    ] {
        let id = Uuid::now_v7();
        let email = format!("{local}-{serie}@cabinet-identite.example");
        sqlx::query(
            r#"
            INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif, role)
            VALUES ($1, $2, $3, $4, $5, TRUE, $6)
            "#,
        )
        .bind(id)
        .bind(cab)
        .bind(&email)
        .bind(&hash)
        .bind(&totp)
        .bind(role)
        .execute(pool)
        .await
        .expect("utilisateur");
        ids.push((id, email));
    }
    let etranger = ids.pop().unwrap();
    let membre = ids.pop().unwrap();
    let admin = ids.pop().unwrap();
    Cabinet {
        admin,
        membre,
        etranger,
    }
}

#[tokio::test]
async fn identite_profil_propre_droits_administrateur_et_aucune_deduction() {
    let (app, pool) = test_app().await;
    let serie = Uuid::now_v7();
    let c = creer_cabinets(&pool, serie).await;
    let token_admin = access_token(&app, &c.admin.1, "identite-admin").await;
    let token_membre = access_token(&app, &c.membre.1, "identite-membre").await;
    let token_membre_bis = access_token(&app, &c.membre.1, "identite-membre-bis").await;

    // Aucune valeur déduite de l'adresse : tout est NULL tant que rien n'est saisi.
    let (st, profil) = json_auth(&app, "GET", "/moi/profil", &token_membre, json!({})).await;
    assert_eq!(st, StatusCode::OK, "{profil:?}");
    assert_eq!(profil["email"], c.membre.1);
    assert_eq!(profil["role"], "collaborateur");
    assert_eq!(profil["revision"], 1);
    for champ in ["civilite", "prenom", "nom", "qualite", "barreau", "toque"] {
        assert!(
            profil[champ].is_null(),
            "{champ} doit rester NULL : {profil:?}"
        );
    }

    // Saisie de son identité ; le rôle envoyé dans le corps est ignoré (aucune auto-attribution).
    let saisie = patch(
        serie,
        1,
        "saisie",
        json!({
            "civilite": "madame",
            "prenom": "  Camille ",
            "nom": "Exemple",
            "qualite": "avocat",
            "barreau": "Paris",
            "toque": "P0123",
            "role": "administrateur",
            "actif": false,
            "email": "autre@exemple.test",
            "initiales": "ZZ"
        }),
    );
    let (st, apres) = json_auth(&app, "PATCH", "/moi/profil", &token_membre, saisie.clone()).await;
    assert_eq!(st, StatusCode::OK, "{apres:?}");
    assert_eq!(apres["prenom"], "Camille", "texte rogné");
    assert_eq!(apres["qualite"], "avocat");
    assert_eq!(apres["barreau"], "Paris");
    assert_eq!(
        apres["role"], "collaborateur",
        "pas d'auto-attribution de rôle"
    );
    assert_eq!(apres["actif"], true);
    assert_eq!(apres["email"], c.membre.1);
    assert!(apres["initiales"].is_null());
    let revision = apres["revision"].as_i64().unwrap();
    assert!(revision > 1);

    // Rejeu par la même clé, puis par une autre clé et les mêmes valeurs : sans effet.
    let autre_cle = fusionner(
        saisie.clone(),
        json!({ "idempotence_cle": format!("{serie}-saisie-bis") }),
    );
    for rejeu in [saisie, autre_cle] {
        let (st, r) = json_auth(&app, "PATCH", "/moi/profil", &token_membre_bis, rejeu).await;
        assert_eq!(st, StatusCode::OK, "{r:?}");
        assert_eq!(r["revision"], revision, "rejeu sans effet");
    }
    let journal: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM journal_modifications WHERE enregistrement_id = $1 AND table_cible = 'utilisateurs' AND champ = 'prenom'",
    )
    .bind(c.membre.0)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(journal, 1, "une seule entrée de journal par changement");

    // Barreau et toque refusés pour une qualité qui n'est pas avocat.
    let (st, refus) = json_auth(
        &app,
        "PATCH",
        "/moi/profil",
        &token_membre,
        patch(
            serie,
            revision,
            "juriste-avec-barreau",
            json!({ "qualite": "juriste" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "{refus:?}");
    let message = refus["message"].as_str().unwrap();
    assert!(message.contains("barreau"), "{message}");
    let (st, _) = json_auth(
        &app,
        "PATCH",
        "/moi/profil",
        &token_membre,
        patch(serie, revision, "qualite-null", json!({ "qualite": null })),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "qualité retirée alors qu'un barreau reste"
    );

    // Valeur vide = NULL ; devenir juriste en retirant barreau et toque dans la même écriture est accepté.
    let (st, juriste) = json_auth(
        &app,
        "PATCH",
        "/moi/profil",
        &token_membre,
        patch(
            serie,
            revision,
            "juriste",
            json!({ "qualite": "juriste", "barreau": "   ", "toque": null, "prenom": "" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{juriste:?}");
    assert!(juriste["barreau"].is_null());
    assert!(juriste["toque"].is_null());
    assert!(juriste["prenom"].is_null(), "chaîne vide = NULL");
    assert_eq!(juriste["qualite"], "juriste");
    let revision = juriste["revision"].as_i64().unwrap();
    let (prenom_base, barreau_base): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT prenom, barreau FROM utilisateurs WHERE id = $1")
            .bind(c.membre.0)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((prenom_base, barreau_base), (None, None));
    let (st, refus) = json_auth(
        &app,
        "PATCH",
        "/moi/profil",
        &token_membre,
        patch(
            serie,
            revision,
            "toque-juriste",
            json!({ "toque": "P0123" }),
        ),
    )
    .await;
    assert_eq!(
        st,
        StatusCode::BAD_REQUEST,
        "toque refusée pour un juriste : {refus:?}"
    );

    // Autres refus : valeurs inconnues, trop longues, corps vide, clé vide, version future.
    for (cle, champs) in [
        ("civ", json!({ "civilite": "mademoiselle" })),
        ("qual", json!({ "qualite": "stagiaire" })),
        ("long", json!({ "nom": "x".repeat(101) })),
    ] {
        let (st, _) = json_auth(
            &app,
            "PATCH",
            "/moi/profil",
            &token_membre,
            patch(serie, revision, cle, champs),
        )
        .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{cle}");
    }
    let (st, _) = json_auth(
        &app,
        "PATCH",
        "/moi/profil",
        &token_membre,
        patch(serie, revision, "vide", json!({})),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        "/moi/profil",
        &token_membre,
        json!({ "base_revision": revision, "idempotence_cle": " ", "nom": "X" }),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        "/moi/profil",
        &token_membre,
        patch(serie, revision + 50, "future", json!({ "nom": "X" })),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Un membre ne modifie pas l'identité d'un autre, ne la lit pas par la liste, ni la sienne par la route
    // d'administration : 403 (le membre est visible, l'action est réservée).
    let route_admin = format!("/utilisateurs/{}/profil", c.admin.0);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &route_admin,
        &token_membre,
        patch(serie, 1, "usurpation", json!({ "nom": "Pirate" })),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/utilisateurs/{}/profil", c.membre.0),
        &token_membre,
        patch(serie, revision, "soi-par-admin", json!({ "nom": "Moi" })),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let (st, _) = json_auth(&app, "GET", "/utilisateurs", &token_membre, json!({})).await;
    assert_eq!(st, StatusCode::FORBIDDEN);
    let nom_admin: Option<String> =
        sqlx::query_scalar("SELECT nom FROM utilisateurs WHERE id = $1")
            .bind(c.admin.0)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        nom_admin, None,
        "l'identité de l'administrateur n'a pas bougé"
    );

    // L'administrateur liste son cabinet (sans secret, sans l'autre cabinet) et modifie un membre.
    let (st, liste) = json_auth(&app, "GET", "/utilisateurs", &token_admin, json!({})).await;
    assert_eq!(st, StatusCode::OK, "{liste:?}");
    let membres = liste.as_array().unwrap();
    assert_eq!(membres.len(), 2);
    assert!(membres.iter().all(|m| m["id"] != c.etranger.0.to_string()));
    let texte_liste = liste.to_string();
    for interdit in ["password", "totp", "hash", "secours"] {
        assert!(!texte_liste.contains(interdit), "{interdit} ne sort jamais");
    }
    let (st, modifie) = json_auth(
        &app,
        "PATCH",
        &format!("/utilisateurs/{}/profil", c.membre.0),
        &token_admin,
        patch(
            serie,
            revision,
            "admin-sur-membre",
            json!({ "civilite": "monsieur", "prenom": "Julien", "nom": "Marchal", "qualite": "avocat_collaborateur", "toque": "B0456" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{modifie:?}");
    assert_eq!(modifie["nom"], "Marchal");
    assert_eq!(modifie["qualite"], "avocat_collaborateur");
    assert_eq!(modifie["role"], "collaborateur");
    let revision_apres = modifie["revision"].as_i64().unwrap();
    let (st, rejeu) = json_auth(
        &app,
        "PATCH",
        &format!("/utilisateurs/{}/profil", c.membre.0),
        &token_admin,
        patch(
            serie,
            revision,
            "admin-sur-membre",
            json!({ "civilite": "monsieur", "prenom": "Julien", "nom": "Marchal", "qualite": "avocat_collaborateur", "toque": "B0456" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(rejeu["revision"], revision_apres, "rejeu sans effet");
    let auteur_journal: Option<Uuid> = sqlx::query_scalar(
        "SELECT auteur_id FROM journal_modifications WHERE enregistrement_id = $1 AND table_cible = 'utilisateurs' AND champ = 'nom' ORDER BY cree_le DESC LIMIT 1",
    )
    .bind(c.membre.0)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        auteur_journal,
        Some(c.admin.0),
        "journalisé au nom de l'administrateur"
    );

    // Utilisateur d'un autre cabinet ou inconnu : 404, rien ne change.
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/utilisateurs/{}/profil", c.etranger.0),
        &token_admin,
        patch(serie, 1, "autre-cabinet", json!({ "nom": "Intrus" })),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (st, _) = json_auth(
        &app,
        "PATCH",
        &format!("/utilisateurs/{}/profil", Uuid::now_v7()),
        &token_admin,
        patch(serie, 1, "inconnu", json!({ "nom": "Intrus" })),
    )
    .await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let nom_etranger: Option<String> =
        sqlx::query_scalar("SELECT nom FROM utilisateurs WHERE id = $1")
            .bind(c.etranger.0)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nom_etranger, None);
}

#[tokio::test]
async fn les_contraintes_de_la_base_refusent_une_identite_incoherente() {
    let (_app, pool) = test_app().await;
    let serie = Uuid::now_v7();
    let c = creer_cabinets(&pool, serie).await;
    for (colonnes, valeur) in [
        ("civilite = 'mademoiselle'", "civilité"),
        ("qualite = 'stagiaire'", "qualité"),
        ("barreau = 'Paris'", "barreau sans avocat"),
        ("prenom = ' Camille'", "texte non rogné"),
        ("toque = repeat('T', 21)", "toque trop longue"),
    ] {
        let sql = format!("UPDATE utilisateurs SET {colonnes} WHERE id = $1");
        let resultat = sqlx::query(&sql).bind(c.membre.0).execute(&pool).await;
        assert!(resultat.is_err(), "{valeur} doit être refusé par la base");
    }
}

/// Le flux `utilisateurs_cabinet` s'exécute tel quel contre Postgres : colonnes d'identité seulement, aucun secret.
#[tokio::test]
async fn le_flux_utilisateurs_ne_porte_que_l_identite() {
    let (_app, pool) = test_app().await;
    let serie = Uuid::now_v7();
    let c = creer_cabinets(&pool, serie).await;
    let yaml = include_str!("../../../instance/powersync/sync-config.yaml");
    let debut = yaml
        .find("  utilisateurs_cabinet:")
        .expect("flux utilisateurs_cabinet");
    let requete = yaml[debut..]
        .lines()
        .find_map(|l| l.trim().strip_prefix("query: "))
        .expect("requête du flux")
        .replace("auth.parameter('cabinet_id')", "$1");
    let cabinet: Uuid = sqlx::query_scalar("SELECT cabinet_id FROM utilisateurs WHERE id = $1")
        .bind(c.membre.0)
        .fetch_one(&pool)
        .await
        .unwrap();
    let lignes = sqlx::query(&requete)
        .bind(cabinet.to_string())
        .fetch_all(&pool)
        .await
        .expect("le flux s'exécute");
    assert_eq!(lignes.len(), 2, "les deux membres du cabinet, pas l'autre");
    use sqlx::{Column, Row};
    let mut noms: Vec<String> = lignes[0]
        .columns()
        .iter()
        .map(|col| col.name().to_string())
        .collect();
    noms.sort();
    let mut attendues: Vec<String> = [
        "id",
        "cabinet_id",
        "email",
        "civilite",
        "prenom",
        "nom",
        "qualite",
        "barreau",
        "toque",
        "initiales",
        "actif",
        "revision",
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect();
    attendues.sort();
    assert_eq!(noms, attendues);
}
