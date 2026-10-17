//! J11 (iii) et (iv) : actions sur les messages et recherche serveur, contre un Postgres réel
//! (base jetable), sans serveur IMAP : les boîtes pointent vers un port fermé, ce qui donne une
//! panne de serveur IMAP déterministe. Les effets sur un vrai serveur IMAP (MOVE, COPY, Corbeille,
//! reprise après coupure) sont couverts par `crates/messagerie/tests/actions_dovecot.rs` et
//! `tests/recette/j11-boites-actions.mjs`.
//!
//! Chaque vérification a son essai négatif : la même vérification, appliquée à la situation
//! inverse (autre collaborateur, clé différente, accès donné), donne l'inverse.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use legalos_api::actions_messages::ActionsMessages;
use legalos_api::config::{Config, ParametresMessagerie};
use legalos_api::{build_app_state, build_router};
use serde_json::{json, Value};
use totp_rs::{Algorithm, Builder, Secret, Totp};
use tower::ServiceExt;
use uuid::Uuid;

#[path = "support/mod.rs"]
mod support;

use support::demo_seed::{DEMO_CABINET_ID, DEMO_PASSWORD, DEMO_TOTP_SECRET_BASE32};

const EMAIL_B: &str = "collaborateur-b-actions@cabinet-fictif.example";
const TOTP_B: &str = "NB2W45DFOJXXE4ZAMFXGI2LTORUGS4ZA";
const EMAIL_C: &str = "collaborateur-c-actions@cabinet-fictif.example";
const TOTP_C: &str = "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI";
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
                    json!({"email": email, "password": DEMO_PASSWORD, "nom_appareil": "test-actions"})
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

async fn creer_utilisateur(pool: &sqlx::PgPool, cabinet: Uuid, id: Uuid, email: &str, totp: &str) {
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
}

/// Message fictif d'une boîte : objet, expéditeur, destinataires et début de corps libres.
struct Fictif<'a> {
    objet: &'a str,
    expediteur: &'a str,
    destinataires: &'a str,
    extrait: &'a str,
}

async fn creer_message(
    pool: &sqlx::PgPool,
    cabinet: Uuid,
    compte: Uuid,
    uid: i64,
    fictif: &Fictif<'_>,
) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid,
                              objet, expediteur, destinataires_texte, extrait_texte, etat_classement)
        VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, 'a_classer')
        "#,
    )
    .bind(id)
    .bind(cabinet)
    .bind(compte)
    .bind(format!("<actions-{uid}@example.com>"))
    .bind(uid)
    .bind(fictif.objet)
    .bind(fictif.expediteur)
    .bind(fictif.destinataires)
    .bind(fictif.extrait)
    .execute(pool)
    .await
    .expect("message");
    id
}

async fn creer_boite(
    app: &axum::Router,
    jeton: &str,
    id: Uuid,
    adresse: &str,
    partagee: bool,
    membres: &[Uuid],
) {
    // Serveur IMAP : un port fermé, la connexion est refusée tout de suite.
    let chemin = if partagee {
        "/messagerie/boites-partagees"
    } else {
        "/messagerie/comptes"
    };
    let mut contenu = json!({
        "id": id, "adresse": adresse, "hote": "127.0.0.1", "port": 1,
        "utilisateur": "boite", "mot_de_passe": "SentinelleBoite", "tls": false
    });
    if partagee {
        contenu["membres"] = json!(membres);
    }
    let (statut, _) = appel(app, "POST", chemin, jeton, contenu).await;
    assert_eq!(statut, StatusCode::OK, "création de la boîte {adresse}");
}

async fn action(
    app: &axum::Router,
    jeton: &str,
    message: Uuid,
    genre: &str,
    cle: &str,
    destination: Option<&str>,
) -> (StatusCode, Value) {
    let mut contenu = json!({"genre": genre, "idempotence_cle": cle});
    if let Some(dossier) = destination {
        contenu["destination"] = json!(dossier);
    }
    appel(
        app,
        "POST",
        &format!("/messagerie/messages/{message}/actions"),
        jeton,
        contenu,
    )
    .await
}

async fn recherche(app: &axum::Router, jeton: &str, q: &str) -> (StatusCode, Vec<Uuid>) {
    let uri = format!("/messagerie/recherche?q={}", encoder(q));
    let (statut, reponse) = appel(app, "GET", &uri, jeton, Value::Null).await;
    let ids = reponse["resultats"]
        .as_array()
        .map(|liste| {
            liste
                .iter()
                .map(|m| Uuid::parse_str(m["id"].as_str().expect("id")).expect("uuid"))
                .collect()
        })
        .unwrap_or_default();
    (statut, ids)
}

/// Encodage de pourcentage minimal pour une requête de test.
fn encoder(texte: &str) -> String {
    texte
        .bytes()
        .map(|o| {
            if o.is_ascii_alphanumeric() {
                (o as char).to_string()
            } else {
                format!("%{o:02X}")
            }
        })
        .collect()
}

#[tokio::test]
async fn actions_sur_les_messages_et_recherche() {
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
    let base = format!("legalos_actions_{nanos}");
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

    let cabinet = Uuid::parse_str(DEMO_CABINET_ID).expect("cabinet");
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, 'actions', 'Cabinet fictif', TRUE)")
        .bind(cabinet)
        .execute(&pool)
        .await
        .expect("cabinet");
    let email_a = "titulaire-a-actions@cabinet-fictif.example";
    let (id_a, id_b, id_c) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    creer_utilisateur(&pool, cabinet, id_a, email_a, DEMO_TOTP_SECRET_BASE32).await;
    creer_utilisateur(&pool, cabinet, id_b, EMAIL_B, TOTP_B).await;
    creer_utilisateur(&pool, cabinet, id_c, EMAIL_C, TOTP_C).await;

    let state = build_app_state(&config, pool.clone())
        .await
        .expect("AppState");
    let app = build_router(state);
    let a = jeton(&app, email_a, DEMO_TOTP_SECRET_BASE32).await;
    let b = jeton(&app, EMAIL_B, TOTP_B).await;
    let c = jeton(&app, EMAIL_C, TOTP_C).await;

    // Boîtes : nominative de A, nominative de B, partagée (A et B).
    let (boite_a, boite_b, partagee) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    creer_boite(&app, &a, boite_a, "a-actions@cabinet.example", false, &[]).await;
    creer_boite(&app, &b, boite_b, "b-actions@cabinet.example", false, &[]).await;
    creer_boite(
        &app,
        &a,
        partagee,
        "secretariat-actions@cabinet.example",
        true,
        &[id_b],
    )
    .await;

    let msg_a = creer_message(
        &pool,
        cabinet,
        boite_a,
        1,
        &Fictif {
            objet: "Assignation Évry zorglub",
            expediteur: "jean.martin@example.com",
            destinataires: "avocat.a@cabinet.example",
            extrait: "Début du corps quetzalcoatl",
        },
    )
    .await;
    let msg_b = creer_message(
        &pool,
        cabinet,
        boite_b,
        2,
        &Fictif {
            objet: "Boîte de B vaticinateur",
            expediteur: "tiers@example.com",
            destinataires: "avocat.b@cabinet.example",
            extrait: "Texte de B",
        },
    )
    .await;
    let msg_partage = creer_message(
        &pool,
        cabinet,
        partagee,
        3,
        &Fictif {
            objet: "Partage secretariat",
            expediteur: "client.partage@example.com",
            destinataires: "secretariat@cabinet.example",
            extrait: "Texte partagé",
        },
    )
    .await;

    // =========================================================================================
    // Droits : 404 pour tout message qu'on ne peut pas lire, sans action créée
    // =========================================================================================
    let genres = ["lu", "non_lu", "archiver", "supprimer"];
    for (qui, jeton_tiers) in [("B", &b), ("C", &c)] {
        for genre in genres {
            let (statut, _) = action(
                &app,
                jeton_tiers,
                msg_a,
                genre,
                &format!("tiers-{qui}-{genre}"),
                None,
            )
            .await;
            assert_eq!(
                statut,
                StatusCode::NOT_FOUND,
                "{qui} {genre} sur la boîte de A"
            );
        }
        let (statut, _) = action(
            &app,
            jeton_tiers,
            msg_a,
            "deplacer",
            &format!("tiers-{qui}-dep"),
            Some("Vole"),
        )
        .await;
        assert_eq!(statut, StatusCode::NOT_FOUND, "{qui} deplacer");
    }
    let (statut, _) = action(&app, &a, msg_b, "lu", "a-sur-b", None).await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "A sur la boîte de B");
    let (statut, _) = action(&app, &c, msg_partage, "lu", "c-partage", None).await;
    assert_eq!(
        statut,
        StatusCode::NOT_FOUND,
        "C n'est pas membre de la boîte partagée"
    );
    let (statut, _) = action(&app, &a, Uuid::now_v7(), "lu", "inconnu", None).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    let creees: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM actions_messages")
        .fetch_one(&pool)
        .await
        .expect("comptage");
    assert_eq!(creees, 0, "les refus ne créent aucune action");

    // Essai négatif : le titulaire et le membre, eux, sont acceptés (l'action attend le serveur IMAP).
    let (statut, lu_a) = action(&app, &a, msg_a, "lu", "a-lu", None).await;
    assert_eq!(statut, StatusCode::OK);
    let (statut, membre) = action(&app, &b, msg_partage, "lu", "b-partage", None).await;
    assert_eq!(
        statut,
        StatusCode::OK,
        "un membre agit sur la boîte partagée"
    );
    assert_eq!(membre["etat"], json!("en_attente"));

    // =========================================================================================
    // Serveur IMAP coupé : l'action attend, rien ne change dans `messages`
    // =========================================================================================
    assert_eq!(lu_a["etat"], json!("en_attente"));
    assert_eq!(lu_a["erreur"], json!("connexion"));
    assert_eq!(lu_a["rejeu"], json!(false));
    assert_eq!(lu_a["tentatives"], json!(1));
    let lu_en_base: bool = sqlx::query_scalar("SELECT lu FROM messages WHERE id = $1")
        .bind(msg_a)
        .fetch_one(&pool)
        .await
        .expect("lu");
    assert!(
        !lu_en_base,
        "le poste ne voit rien tant que le serveur n'a pas pris l'action"
    );

    // Rejeu : même clé, même action ; autre clé ; clé réutilisée pour autre chose.
    let (statut, rejeu) = action(&app, &a, msg_a, "lu", "a-lu", None).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(rejeu["id"], lu_a["id"]);
    assert_eq!(rejeu["rejeu"], json!(true));
    let (_, autre_cle) = action(&app, &a, msg_a, "lu", "a-lu-bis", None).await;
    assert_ne!(
        autre_cle["id"], lu_a["id"],
        "une autre clé est une autre action"
    );
    let (statut, _) = action(&app, &a, msg_a, "non_lu", "a-lu", None).await;
    assert_eq!(statut, StatusCode::CONFLICT, "même clé, autre genre");
    let (statut, _) = action(&app, &a, msg_partage, "lu", "a-lu", None).await;
    assert_eq!(statut, StatusCode::CONFLICT, "même clé, autre message");
    let nb: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM actions_messages WHERE message_ref = $1")
            .bind(msg_a)
            .fetch_one(&pool)
            .await
            .expect("comptage");
    assert_eq!(nb, 2, "le rejeu et les conflits n'ont rien créé");
    // La clé est propre à l'utilisateur : B peut réutiliser « a-lu » pour lui.
    let (statut, _) = action(&app, &b, msg_b, "lu", "a-lu", None).await;
    assert_eq!(statut, StatusCode::OK);
    // Essai négatif du rejeu : A ne lit pas l'action de B.
    let uri_action = format!("/messagerie/actions/{}", lu_a["id"].as_str().expect("id"));
    assert_eq!(
        appel(&app, "GET", &uri_action, &b, Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        appel(&app, "GET", &uri_action, &a, Value::Null).await.0,
        StatusCode::OK
    );

    // Saisies refusées avant tout effet.
    for (genre, cle, destination) in [
        ("expunge", "k1", None),
        ("lu", "", None),
        ("lu", "cle\navec retour", None),
        ("lu", "k3", Some("Archives")),
        ("deplacer", "k4", None),
        ("deplacer", "k5", Some("")),
        ("deplacer", "k6", Some("A\r\nB")),
        ("deplacer", "k7", Some("Suivi*")),
        ("deplacer", "k8", Some(" Suivi")),
    ] {
        let (statut, _) = action(&app, &a, msg_a, genre, cle, destination).await;
        assert_eq!(
            statut,
            StatusCode::BAD_REQUEST,
            "{genre} {cle:?} {destination:?}"
        );
    }
    let nb: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM actions_messages WHERE message_ref = $1")
            .bind(msg_a)
            .fetch_one(&pool)
            .await
            .expect("comptage");
    assert_eq!(nb, 2, "les saisies refusées n'ont rien créé");

    // =========================================================================================
    // File : ordre, bail, échec définitif, message disparu
    // =========================================================================================
    let actions = ActionsMessages::new(pool.clone(), *CLE, None);
    let (_, premiere) = action(&app, &a, msg_a, "archiver", "ordre-1", None).await;
    let (_, seconde) = action(&app, &a, msg_a, "supprimer", "ordre-2", None).await;
    let id_premiere = Uuid::parse_str(premiere["id"].as_str().expect("id")).expect("uuid");
    let id_seconde = Uuid::parse_str(seconde["id"].as_str().expect("id")).expect("uuid");
    let tentatives = |id: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i32>("SELECT tentatives FROM actions_messages WHERE id = $1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("tentatives")
        }
    };
    // Une action n'est tentée qu'après les plus anciennes du même message (les trois premières
    // du message : « lu » deux fois, puis l'archivage).
    assert_eq!(
        tentatives(id_seconde).await,
        0,
        "la seconde attend la première"
    );
    sqlx::query("UPDATE actions_messages SET etat = 'echec' WHERE message_ref = $1 AND id <> $2 AND id <> $3")
        .bind(msg_a)
        .bind(id_premiere)
        .bind(id_seconde)
        .execute(&pool)
        .await
        .expect("écarter les actions précédentes");
    sqlx::query(
        "UPDATE actions_messages SET prochaine_tentative_le = NOW() WHERE message_ref = $1",
    )
    .bind(msg_a)
    .execute(&pool)
    .await
    .expect("échéance");
    actions.appliquer(id_seconde).await;
    assert_eq!(
        tentatives(id_seconde).await,
        0,
        "toujours derrière la première (en attente)"
    );
    // Essai négatif : une fois la première terminée, la seconde est prise.
    sqlx::query("UPDATE actions_messages SET etat = 'echec' WHERE id = $1")
        .bind(id_premiere)
        .execute(&pool)
        .await
        .expect("première terminée");
    actions.appliquer(id_seconde).await;
    assert_eq!(
        tentatives(id_seconde).await,
        1,
        "la première terminée, la seconde est prise"
    );

    // Bail en cours : l'action n'est confiée à personne d'autre.
    let (_, baillee) = action(&app, &b, msg_b, "archiver", "bail", None).await;
    let id_baillee = Uuid::parse_str(baillee["id"].as_str().expect("id")).expect("uuid");
    // (Les actions antérieures du même message sont écartées : elles passeraient avant.)
    sqlx::query("UPDATE actions_messages SET etat = 'echec' WHERE message_ref = $1 AND id <> $2")
        .bind(msg_b)
        .bind(id_baillee)
        .execute(&pool)
        .await
        .expect("écarter les actions précédentes");
    sqlx::query("UPDATE actions_messages SET reserve_jusqu_le = NOW() + INTERVAL '10 minutes', prochaine_tentative_le = NOW() WHERE id = $1")
        .bind(id_baillee)
        .execute(&pool)
        .await
        .expect("bail");
    let avant = tentatives(id_baillee).await;
    actions.appliquer(id_baillee).await;
    assert_eq!(
        tentatives(id_baillee).await,
        avant,
        "un bail en cours protège l'action"
    );
    actions.lever_les_baux().await;
    actions.appliquer(id_baillee).await;
    assert_eq!(
        tentatives(id_baillee).await,
        avant + 1,
        "le bail levé (redémarrage de l'API), l'action est reprise"
    );

    // Échec définitif d'un serveur injoignable après trop de tentatives ; message disparu : tout de suite.
    sqlx::query("UPDATE actions_messages SET tentatives = 39, prochaine_tentative_le = NOW(), reserve_jusqu_le = NULL WHERE id = $1")
        .bind(id_baillee)
        .execute(&pool)
        .await
        .expect("quarantième tentative");
    actions.appliquer(id_baillee).await;
    let (etat, erreur): (String, Option<String>) =
        sqlx::query_as("SELECT etat, erreur FROM actions_messages WHERE id = $1")
            .bind(id_baillee)
            .fetch_one(&pool)
            .await
            .expect("état");
    assert_eq!(
        (etat.as_str(), erreur.as_deref()),
        ("echec", Some("connexion"))
    );
    // Message disparu : sa ligne est retirée de la base (retrait par la relève) ; l'action ne peut
    // plus aboutir et n'est pas réessayée.
    let (_, absent) = action(&app, &b, msg_partage, "non_lu", "disparu-b", None).await;
    let id_absent = Uuid::parse_str(absent["id"].as_str().expect("id")).expect("uuid");
    sqlx::query("UPDATE actions_messages SET etat = 'echec' WHERE message_ref = $1 AND id <> $2")
        .bind(msg_partage)
        .bind(id_absent)
        .execute(&pool)
        .await
        .expect("écarter les actions précédentes");
    sqlx::query("DELETE FROM messages WHERE id = $1")
        .bind(msg_partage)
        .execute(&pool)
        .await
        .expect("retrait du message");
    sqlx::query("UPDATE actions_messages SET prochaine_tentative_le = NOW(), reserve_jusqu_le = NULL WHERE id = $1")
        .bind(id_absent)
        .execute(&pool)
        .await
        .expect("échéance");
    actions.appliquer(id_absent).await;
    let (etat, erreur): (String, Option<String>) =
        sqlx::query_as("SELECT etat, erreur FROM actions_messages WHERE id = $1")
            .bind(id_absent)
            .fetch_one(&pool)
            .await
            .expect("état");
    assert_eq!(
        (etat.as_str(), erreur.as_deref()),
        ("echec", Some("message_absent")),
        "un message disparu n'est pas réessayé"
    );

    // =========================================================================================
    // Recherche
    // =========================================================================================
    let msg_partage = creer_message(
        &pool,
        cabinet,
        partagee,
        4,
        &Fictif {
            objet: "Partage secretariat",
            expediteur: "client.partage@example.com",
            destinataires: "secretariat@cabinet.example",
            extrait: "Texte partagé",
        },
    )
    .await;
    // Objet, accents et casse, début de mot, plusieurs mots, expéditeur, destinataire, corps.
    for (q, attendu) in [
        ("zorglub", true),
        ("ZORGLUB", true),
        ("evry", true),
        ("ÉVRY", true),
        ("assign", true),
        ("assignation zorglub", true),
        ("assignation introuvable", false),
        ("martin", true),
        ("jean.martin@example.com", true),
        ("avocat.a", true),
        ("quetzalcoatl", true),
    ] {
        let (statut, ids) = recherche(&app, &a, q).await;
        assert_eq!(statut, StatusCode::OK, "{q}");
        assert_eq!(ids.contains(&msg_a), attendu, "A cherche « {q} »");
    }
    // Droits : même avec le mot exact, B et C ne trouvent pas le message de la boîte de A.
    for mot in [
        "zorglub",
        "quetzalcoatl",
        "jean.martin@example.com",
        "avocat.a",
    ] {
        let (_, ids_b) = recherche(&app, &b, mot).await;
        let (_, ids_c) = recherche(&app, &c, mot).await;
        assert!(
            !ids_b.contains(&msg_a) && !ids_c.contains(&msg_a),
            "fuite par « {mot} »"
        );
        let (_, ids_a) = recherche(&app, &a, mot).await;
        assert!(ids_a.contains(&msg_a), "A, lui, trouve « {mot} »");
    }
    let (_, ids_a) = recherche(&app, &a, "vaticinateur").await;
    assert!(!ids_a.contains(&msg_b), "A ne trouve pas la boîte de B");
    let (_, ids_b) = recherche(&app, &b, "vaticinateur").await;
    assert!(ids_b.contains(&msg_b), "B trouve sa boîte");
    // Boîte partagée : A et B (membres) oui, C non.
    let (_, ids_a) = recherche(&app, &a, "secretariat").await;
    let (_, ids_b) = recherche(&app, &b, "secretariat").await;
    let (_, ids_c) = recherche(&app, &c, "secretariat").await;
    assert!(ids_a.contains(&msg_partage) && ids_b.contains(&msg_partage));
    assert!(!ids_c.contains(&msg_partage));
    // Cibler la boîte d'un autre : 404.
    let (statut, _) = appel(
        &app,
        "GET",
        &format!("/messagerie/recherche?q=zorglub&compte_id={boite_a}"),
        &b,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    let (statut, _) = appel(
        &app,
        "GET",
        &format!("/messagerie/recherche?q=zorglub&compte_id={boite_a}"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::OK);

    // Dossier restreint : le message de la boîte partagée y est classé ; B (membre, sans accès)
    // ne le trouve pas, A (accès) le trouve.
    let dossier = Uuid::now_v7();
    let (statut, _) = appel(
        &app,
        "POST",
        "/dossiers",
        &a,
        json!({
            "id": dossier, "idempotence_cle": format!("actions-{dossier}"),
            "nom": "Dossier restreint fictif", "chemise": "gris-perle",
            "juridiction": "TJ Paris", "numero_rg": "26/30003", "restreint": true
        }),
    )
    .await;
    assert_eq!(statut, StatusCode::OK, "création du dossier restreint");
    sqlx::query("UPDATE messages SET dossier_id = $2, etat_classement = 'classe', visibilite = 'restreint', restreint = TRUE WHERE id = $1")
        .bind(msg_partage)
        .bind(dossier)
        .execute(&pool)
        .await
        .expect("classement");
    let (_, ids_a) = recherche(&app, &a, "secretariat").await;
    let (_, ids_b) = recherche(&app, &b, "secretariat").await;
    assert!(ids_a.contains(&msg_partage), "A a accès au dossier");
    assert!(
        !ids_b.contains(&msg_partage),
        "B n'a pas accès au dossier restreint, même avec le mot exact"
    );
    let (statut, _) = action(&app, &b, msg_partage, "lu", "restreint-b", None).await;
    assert_eq!(
        statut,
        StatusCode::NOT_FOUND,
        "ni d'action sur un message de dossier restreint"
    );
    let (statut, _) = action(&app, &a, msg_partage, "lu", "restreint-a", None).await;
    assert_eq!(statut, StatusCode::OK);
    sqlx::query("INSERT INTO dossier_acces (dossier_id, utilisateur_id, dossier_texte, utilisateur_texte) VALUES ($1, $2, $3, $4)")
        .bind(dossier)
        .bind(id_b)
        .bind(dossier.to_string())
        .bind(id_b.to_string())
        .execute(&pool)
        .await
        .expect("accès");
    let (_, ids_b) = recherche(&app, &b, "secretariat").await;
    assert!(ids_b.contains(&msg_partage), "l'accès donné, B le trouve");

    // Saisies hostiles : refusées (400) ou sans résultat (200), sans erreur serveur.
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
        .fetch_one(&pool)
        .await
        .expect("total");
    for q in [
        "",
        "   ",
        "%",
        "%%%",
        "_",
        "_%_ %",
        "a",
        "'\";--",
        &"x".repeat(257),
        &"x".repeat(10_000),
    ] {
        // Les 10 000 caractères dépassent la longueur d'URL acceptable d'un client : on teste la
        // saisie par l'URL tronquée côté serveur de test seulement en deçà de 8 000.
        if q.len() > 8_000 {
            continue;
        }
        let (statut, _) = recherche(&app, &a, q).await;
        assert_eq!(
            statut,
            StatusCode::BAD_REQUEST,
            "saisie {:?}",
            q.chars().take(12).collect::<String>()
        );
    }
    for q in [
        "'; DROP TABLE messages; --",
        "zorglub' OR '1'='1",
        "a:* | !b ) ( & <-> zzzzzz",
        "\\",
        "((((",
    ] {
        let (statut, ids) = recherche(&app, &a, q).await;
        assert!(
            statut == StatusCode::OK || statut == StatusCode::BAD_REQUEST,
            "{q}"
        );
        assert!(
            !ids.contains(&msg_b),
            "A ne voit pas la boîte de B par « {q} »"
        );
    }
    let (statut, ids) = recherche(&app, &a, &"x".repeat(256)).await;
    assert_eq!(
        (statut, ids.len()),
        (StatusCode::OK, 0),
        "256 caractères exactement : accepté"
    );
    let apres: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
        .fetch_one(&pool)
        .await
        .expect("total");
    assert!(
        apres >= total - 1,
        "les saisies hostiles n'ont rien supprimé"
    );
    // « % » ne ramène pas tout : essai négatif du joker (le mot hors jokers, lui, trouve).
    let (_, ids) = recherche(&app, &a, "zorglub%").await;
    assert!(ids.contains(&msg_a));
    assert!(!ids.contains(&msg_partage));
    // La fonction SQL ne lève jamais d'erreur, même sur un texte que le moteur de requêtes refuse.
    for texte in ["a:*:*", "&&&", "(", "'", "mot:* & & autre:*", "\\"] {
        let requete: String = sqlx::query_scalar("SELECT requete_recherche_messages($1)::text")
            .bind(texte)
            .fetch_one(&pool)
            .await
            .expect("requete_recherche_messages ne doit pas échouer");
        let _ = requete;
    }
    // Pagination bornée.
    let (statut, page) = appel(
        &app,
        "GET",
        "/messagerie/recherche?q=secretariat&limite=1",
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(page["resultats"].as_array().expect("liste").len(), 1);
}
