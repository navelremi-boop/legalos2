//! Droits sur toute l'API, contre un Postgres réel (consigne de l'architecte du 22/10/2026, refus du contrôleur J11) :
//! une ressource d'un autre cabinet, ou d'un dossier restreint hors `dossier_acces`, se comporte exactement comme une
//! ressource absente : **404**, même message, aucun montant ni aucune donnée dans la réponse. Jamais 401 (le poste le
//! lit comme une session expirée et sa file d'envoi ne le tient pas pour définitif) ni 400.
//!
//! Chaque refus a son témoin positif : la même requête, faite par quelqu'un qui a le droit, réussit.
//! Le scénario tourne dans une base jetable.
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

const EMAIL_A: &str = "titulaire-a-droits@cabinet-fictif.example";
const EMAIL_B: &str = "collaborateur-b-droits@cabinet-fictif.example";
const TOTP_B: &str = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
const EMAIL_X: &str = "externe-x-droits@autre-cabinet-fictif.example";
const TOTP_X: &str = "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI";
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

async fn jeton(app: &axum::Router, email: &str, totp: &str) -> String {
    let connexion = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/connexion")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"email": email, "password": DEMO_PASSWORD, "nom_appareil": "test-droits"})
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

async fn creer_utilisateur(pool: &sqlx::PgPool, cabinet: Uuid, email: &str, totp: &str) -> Uuid {
    let id = Uuid::now_v7();
    let hash = legalos_api::auth::password::hash_password(DEMO_PASSWORD).expect("hash");
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
    id
}

/// Dossier créé par l'API (déclencheurs, `dossier_acces` du créateur compris).
async fn creer_dossier(app: &axum::Router, jeton: &str, restreint: bool) -> Uuid {
    let id = Uuid::now_v7();
    let (statut, reponse) = appel(
        app,
        "POST",
        "/dossiers",
        jeton,
        json!({
            "id": id,
            "idempotence_cle": format!("droits-{id}"),
            "nom": format!("Dossier fictif {id}"),
            "chemise": "kraft",
            "juridiction": "TJ Nanterre",
            "numero_rg": "26/70001",
            "restreint": restreint
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "{reponse:?}");
    id
}

fn corps_facture(id: Uuid, dossier: Uuid) -> Value {
    json!({
        "id": id,
        "dossier_id": dossier,
        "taux_tva_bp": 2000,
        "type_client": "particulier",
        "lignes": [{"libelle": "Honoraires fictifs", "nature": "honoraires", "montant_ht_centimes": 12_300}]
    })
}

/// Brouillon créé par l'API puis validé directement en base, avec ses artefacts : le PDF Factur-X n'est pas ce qui
/// est éprouvé ici (Typst n'est pas requis).
async fn facture_validee(
    app: &axum::Router,
    pool: &sqlx::PgPool,
    jeton: &str,
    dossier: Uuid,
) -> Uuid {
    let id = Uuid::now_v7();
    let (statut, reponse) =
        appel(app, "POST", "/factures", jeton, corps_facture(id, dossier)).await;
    assert_eq!(statut, StatusCode::OK, "{reponse:?}");
    assert_eq!(reponse["statut"], "brouillon");
    sqlx::query("UPDATE factures SET statut = 'validee', numero = (SELECT COALESCE(MAX(numero), 0) + 1 FROM factures f2 WHERE f2.cabinet_id = factures.cabinet_id) WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .expect("validation directe");
    sqlx::query(
        "INSERT INTO facture_artefacts (facture_id, cii_xml, pdf_octets) VALUES ($1, '<cii/>', $2)",
    )
    .bind(id)
    .bind(vec![0x25_u8, 0x50, 0x44, 0x46])
    .execute(pool)
    .await
    .expect("artefacts");
    id
}

/// Une réponse « introuvable » : 404 et rien d'autre que le message.
fn assert_introuvable(resultat: &(StatusCode, Value), contexte: &str) {
    assert_eq!(
        resultat.0,
        StatusCode::NOT_FOUND,
        "{contexte} : {:?}",
        resultat.1
    );
    assert_eq!(resultat.1["code"], "not_found", "{contexte}");
    let texte = resultat.1.to_string();
    assert!(
        !texte.contains("montant") && !texte.contains("numero\""),
        "{contexte} : la réponse porte des données : {texte}"
    );
}

#[tokio::test]
async fn droits_404_dossier_restreint_autre_cabinet_et_boite_de_classement() {
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
    let base = format!("legalos_droits_{nanos}");
    sqlx::query(&format!("CREATE DATABASE \"{base}\""))
        .execute(&admin)
        .await
        .expect("create database");
    // Le scénario tourne dans sa propre tâche : une assertion qui échoue n'empêche pas la suppression de la base.
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

#[allow(clippy::too_many_lines)]
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
    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    let app = build_router(state);

    let cabinet1 = Uuid::parse_str(DEMO_CABINET_ID).expect("cabinet");
    let cabinet2 = Uuid::now_v7();
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, 'droits-1', 'Cabinet fictif un', TRUE), ($2, 'droits-2', 'Cabinet fictif deux', TRUE)")
        .bind(cabinet1)
        .bind(cabinet2)
        .execute(&pool)
        .await
        .expect("cabinets");
    creer_utilisateur(&pool, cabinet1, EMAIL_A, DEMO_TOTP_SECRET_BASE32).await;
    creer_utilisateur(&pool, cabinet1, EMAIL_B, TOTP_B).await;
    creer_utilisateur(&pool, cabinet2, EMAIL_X, TOTP_X).await;
    let a = jeton(&app, EMAIL_A, DEMO_TOTP_SECRET_BASE32).await;
    let b = jeton(&app, EMAIL_B, TOTP_B).await;
    let x = jeton(&app, EMAIL_X, TOTP_X).await;

    // A : un dossier ouvert et un dossier restreint (A seul y a accès) ; X : son propre dossier.
    let ouvert = creer_dossier(&app, &a, false).await;
    let restreint = creer_dossier(&app, &a, true).await;
    let dossier_x = creer_dossier(&app, &x, false).await;
    let absent = Uuid::now_v7();

    // ===== 1. Dossier restreint : 404 pour B, comme un dossier qui n'existe pas (jamais 401 ni 400) =====
    let requetes: Vec<(&str, String, Value, &str)> = vec![
        (
            "POST",
            format!("/dossiers/{restreint}/parties"),
            json!({"id": Uuid::now_v7(), "idempotence_cle": "partie-droits-1", "role": "client", "nom": "Partie fictive"}),
            "partie",
        ),
        (
            "POST",
            format!("/dossiers/{restreint}/intercalaires"),
            json!({"id": Uuid::now_v7(), "idempotence_cle": "interc-droits-1", "nom": "Pièces fictives"}),
            "intercalaire",
        ),
        (
            "POST",
            "/repertoires".to_owned(),
            json!({"id": Uuid::now_v7(), "dossier_id": restreint, "nom": "Répertoire fictif", "idempotence_cle": "rep-droits-1"}),
            "répertoire",
        ),
        (
            "POST",
            "/temps".to_owned(),
            json!({"id": Uuid::now_v7(), "dossier_id": restreint, "minutes": 30, "libelle": "Temps fictif", "taux_centimes_heure": 20_000, "idempotence_cle": "temps-droits-1"}),
            "temps",
        ),
        (
            "POST",
            "/factures".to_owned(),
            corps_facture(Uuid::now_v7(), restreint),
            "facture",
        ),
    ];
    for (methode, chemin, contenu, genre) in &requetes {
        let refus = appel(&app, methode, chemin, &b, contenu.clone()).await;
        assert_introuvable(&refus, &format!("B, dossier restreint, {genre}"));
        // Essai négatif : le titulaire de l'accès réussit la même requête (témoin positif).
        let mut contenu_a = contenu.clone();
        if let Some(cle) = contenu_a.get_mut("idempotence_cle") {
            *cle = json!(format!("a-{}", cle.as_str().unwrap()));
        }
        if let Some(id) = contenu_a.get_mut("id") {
            *id = json!(Uuid::now_v7());
        }
        let reussite = appel(&app, methode, chemin, &a, contenu_a).await;
        assert_eq!(
            reussite.0,
            StatusCode::OK,
            "A, dossier restreint, {genre} : {:?}",
            reussite.1
        );
    }
    // Un dossier qui n'existe pas répond comme un dossier fermé : même statut, même code, même message.
    let contenu_temps = json!({"id": Uuid::now_v7(), "dossier_id": absent, "minutes": 30, "libelle": "Temps fictif", "taux_centimes_heure": 20_000, "idempotence_cle": "temps-droits-absent"});
    let sur_absent = appel(&app, "POST", "/temps", &a, contenu_temps).await;
    let sur_ferme = appel(
        &app,
        "POST",
        "/temps",
        &b,
        json!({"id": Uuid::now_v7(), "dossier_id": restreint, "minutes": 30, "libelle": "Temps fictif", "taux_centimes_heure": 20_000, "idempotence_cle": "temps-droits-ferme"}),
    )
    .await;
    assert_eq!(
        sur_absent, sur_ferme,
        "dossier absent et dossier fermé doivent se ressembler"
    );

    // ===== 2. Autre cabinet : le cabinet de A n'existe pas pour X =====
    assert_introuvable(
        &appel(
            &app,
            "PATCH",
            &format!("/cabinets/{cabinet1}"),
            &x,
            json!({"idempotence_cle": "cab-droits-x", "base_revision": 1, "nom": "Nom volé"}),
        )
        .await,
        "X, cabinet d'un autre",
    );
    assert_introuvable(
        &appel(
            &app,
            "POST",
            "/factures",
            &x,
            corps_facture(Uuid::now_v7(), ouvert),
        )
        .await,
        "X, facture dans le dossier d'un autre cabinet",
    );

    // ===== 3. Factures : rien d'une facture fermée ne sort, par aucune route =====
    let facture_fermee = facture_validee(&app, &pool, &a, restreint).await;
    let facture_ouverte = facture_validee(&app, &pool, &a, ouvert).await;
    let facture_x = facture_validee(&app, &pool, &x, dossier_x).await;

    // Témoins positifs : A lit et rejoue sa propre facture fermée, B lit la facture ouverte.
    assert_eq!(
        appel(
            &app,
            "GET",
            &format!("/factures/{facture_fermee}/pdf"),
            &a,
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        appel(
            &app,
            "GET",
            &format!("/factures/{facture_ouverte}/cii"),
            &b,
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    let rejeu = appel(
        &app,
        "POST",
        "/factures",
        &a,
        corps_facture(facture_fermee, restreint),
    )
    .await;
    assert_eq!(
        rejeu.0,
        StatusCode::OK,
        "rejeu du même brouillon par son auteur : {:?}",
        rejeu.1
    );
    assert_eq!(rejeu.1["montant_ht_centimes"], 12_300);

    // B n'a pas accès au dossier restreint : toutes les routes de la facture fermée répondent 404.
    let sur_facture_fermee: Vec<(&str, String, Value)> = vec![
        (
            "GET",
            format!("/factures/{facture_fermee}/cii"),
            Value::Null,
        ),
        (
            "GET",
            format!("/factures/{facture_fermee}/pdf"),
            Value::Null,
        ),
        (
            "POST",
            format!("/factures/{facture_fermee}/valider"),
            Value::Null,
        ),
        (
            "POST",
            format!("/factures/{facture_fermee}/emettre"),
            json!({"cle_idempotence": "emission-droits-1"}),
        ),
        (
            "POST",
            format!("/factures/{facture_fermee}/encaissements"),
            json!({"montant_centimes": 100, "cle_idempotence": "encaissement-droits-1"}),
        ),
        (
            "POST",
            format!("/factures/{facture_fermee}/avoir"),
            json!({"id": Uuid::now_v7()}),
        ),
    ];
    for (methode, chemin, contenu) in &sur_facture_fermee {
        assert_introuvable(
            &appel(&app, methode, chemin, &b, contenu.clone()).await,
            &format!("B, {methode} {chemin}"),
        );
        // X (autre cabinet) : même réponse.
        assert_introuvable(
            &appel(&app, methode, chemin, &x, contenu.clone()).await,
            &format!("X, {methode} {chemin}"),
        );
    }
    // Facture absente : même réponse que facture fermée.
    assert_eq!(
        appel(
            &app,
            "GET",
            &format!("/factures/{}/cii", Uuid::now_v7()),
            &b,
            Value::Null
        )
        .await,
        appel(
            &app,
            "GET",
            &format!("/factures/{facture_fermee}/cii"),
            &b,
            Value::Null
        )
        .await,
        "facture absente et facture fermée doivent se ressembler"
    );

    // Fuite par rejeu de création : l'identifiant d'une facture d'un autre cabinet, d'un dossier fermé, ou d'un
    // autre dossier, ne rend jamais ses montants.
    for (qui, jeton_qui, dossier_demande, facture_visee, contexte) in [
        (
            "X",
            &x,
            dossier_x,
            facture_fermee,
            "X rejoue l'identifiant d'une facture d'un autre cabinet",
        ),
        (
            "B",
            &b,
            ouvert,
            facture_fermee,
            "B rejoue l'identifiant d'une facture d'un dossier fermé",
        ),
        (
            "A",
            &a,
            ouvert,
            facture_fermee,
            "A rejoue l'identifiant de sa facture dans un autre dossier",
        ),
    ] {
        let reponse = appel(
            &app,
            "POST",
            "/factures",
            jeton_qui,
            corps_facture(facture_visee, dossier_demande),
        )
        .await;
        assert_introuvable(&reponse, &format!("{qui} : {contexte}"));
    }

    // Fuite par rejeu d'avoir : X vise l'identifiant d'une facture d'un autre cabinet comme « avoir » de la sienne.
    assert_introuvable(
        &appel(
            &app,
            "POST",
            &format!("/factures/{facture_x}/avoir"),
            &x,
            json!({"id": facture_fermee}),
        )
        .await,
        "X, avoir dont l'identifiant est celui d'une facture d'un autre cabinet",
    );
    // A, avoir dont l'identifiant est celui d'une autre facture de son cabinet (pas un avoir de cette origine).
    assert_introuvable(
        &appel(
            &app,
            "POST",
            &format!("/factures/{facture_ouverte}/avoir"),
            &a,
            json!({"id": facture_fermee}),
        )
        .await,
        "A, avoir dont l'identifiant est celui d'une autre facture",
    );
    // La facture d'un autre cabinet reste intacte : mêmes montants, même statut.
    let (statut_x, montant_x): (String, i64) =
        sqlx::query_as("SELECT statut, montant_ttc_centimes FROM factures WHERE id = $1")
            .bind(facture_x)
            .fetch_one(&pool)
            .await
            .expect("facture de X");
    assert_eq!((statut_x.as_str(), montant_x), ("validee", 14_760));

    // ===== 4. Les routes /messagerie/nominatif/* n'existent plus (consigne de l'architecte du 24/10/2026) =====
    // Elles agissaient sur la boîte IMAP unique de l'instance, hors du modèle de droits des actions par message
    // (`/messagerie/messages/{id}/actions`), que le poste utilise seule. Une route supprimée répond 404 à tous, y
    // compris à un utilisateur authentifié, quelle que soit la méthode.
    for (methode, chemin) in [
        ("POST", "/messagerie/nominatif/relever"),
        ("POST", "/messagerie/nominatif/attendre"),
        ("POST", "/messagerie/nominatif/lu"),
        ("POST", "/messagerie/nominatif/deplacer"),
        ("POST", "/messagerie/nominatif/supprimer"),
        ("POST", "/messagerie/nominatif/drapeau"),
        ("GET", "/messagerie/nominatif/recherche"),
        ("GET", "/messagerie/nominatif/contenu"),
    ] {
        let reponse = appel(&app, methode, chemin, &a, json!({"uid": 1})).await;
        assert_eq!(
            reponse.0,
            StatusCode::NOT_FOUND,
            "{methode} {chemin} : {:?}",
            reponse.1
        );
    }
    // Témoin positif : une route qui existe répond autre chose que 404 au même utilisateur.
    let sante = appel(&app, "GET", "/messagerie/sante", &a, Value::Null).await;
    assert_eq!(sante.0, StatusCode::OK, "{:?}", sante.1);
}
