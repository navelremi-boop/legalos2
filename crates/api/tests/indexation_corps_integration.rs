//! Indexation de fond des corps (J11, D6, consigne de l'architecte du 24/10/2026), contre un Postgres réel :
//!
//! * tentatives bornées : cinq, avec une attente qui croît, puis le message est abandonné (compté dans
//!   `corps_abandonnes`, plus jamais sélectionné) ;
//! * un message dont l'UIDVALIDITY n'est plus celle de son dossier n'est ni sélectionné ni compté parmi les « à venir »
//!   jusqu'à sa resynchronisation, de sorte que la progression finit par « terminée » (rien à venir) ;
//! * chaque règle a son essai négatif : la situation inverse donne l'inverse.
//!
//! Le scénario tourne dans une base jetable.
#![allow(clippy::expect_used)]

use std::time::{SystemTime, UNIX_EPOCH};

use legalos_api::indexation_corps::{
    delai_apres_echecs, messages_a_indexer, noter_echec, progression, DELAIS_ECHEC_MINUTES,
    TENTATIVES_MAX,
};
use uuid::Uuid;

fn environnement() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = dotenvy::dotenv();
        if std::env::var("DATABASE_URL").is_err() {
            let _ = dotenvy::from_filename("../../.env");
        }
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

#[test]
fn indexation_corps_attente_croissante_et_bornee() {
    assert_eq!(TENTATIVES_MAX, 5);
    // Un échec, deux, trois, quatre et plus : l'attente ne décroît jamais et finit par plafonner.
    let delais: Vec<i64> = (1..=6).map(delai_apres_echecs).collect();
    assert_eq!(delais, vec![2, 10, 60, 360, 360, 360]);
    assert!(
        delais.windows(2).all(|w| w[0] <= w[1]),
        "attente non croissante"
    );
    assert_eq!(DELAIS_ECHEC_MINUTES.len(), 4);
    // Essai négatif : une attente constante ne passerait pas ce contrôle.
    assert!(delais.first() < delais.last());
}

#[tokio::test]
async fn indexation_corps_progression_et_tentatives_bornees() {
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
    let base = format!("legalos_indexation_{nanos}");
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

async fn message(
    pool: &sqlx::PgPool,
    cabinet: Uuid,
    compte: Uuid,
    uid: i64,
    uid_validity: i64,
) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO messages (id, cabinet_id, compte_id, message_id, uid_validity, uid, objet, expediteur, etat_classement)
        VALUES ($1, $2, $3, $4, $5, $6, 'Objet fictif', 'tiers@example.com', 'a_classer')
        "#,
    )
    .bind(id)
    .bind(cabinet)
    .bind(compte)
    .bind(format!("<indexation-{uid}-{uid_validity}@example.com>"))
    .bind(uid_validity)
    .bind(uid)
    .execute(pool)
    .await
    .expect("message");
    id
}

#[allow(clippy::too_many_lines)]
async fn scenario(url_base_jetable: String) {
    let pool = legalos_api::db::connect_pool(&url_base_jetable)
        .await
        .expect("connexion base jetable");
    legalos_api::db::appliquer_migrations(&pool)
        .await
        .expect("migrations");
    let cabinet = Uuid::now_v7();
    sqlx::query("INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, 'indexation', 'Cabinet fictif', TRUE)")
        .bind(cabinet)
        .execute(&pool)
        .await
        .expect("cabinet");
    let compte = Uuid::now_v7();
    sqlx::query("INSERT INTO comptes_mail (id, cabinet_id, type_compte, adresse, secret_ref) VALUES ($1, $2, 'classement', 'classement@cabinet.example', 'test')")
        .bind(compte)
        .bind(cabinet)
        .execute(&pool)
        .await
        .expect("compte");
    // Le dossier a aujourd'hui l'UIDVALIDITY 7.
    sqlx::query("INSERT INTO releve_curseurs (compte_id, dossier_imap, uid_validity, dernier_uid) VALUES ($1, 'INBOX', 7, 100)")
        .bind(compte)
        .execute(&pool)
        .await
        .expect("curseur");

    let a_lire = message(&pool, cabinet, compte, 1, 7).await;
    let perime = message(&pool, cabinet, compte, 2, 3).await; // génération d'UID périmée
    let indexe = message(&pool, cabinet, compte, 3, 7).await;
    let capricieux = message(&pool, cabinet, compte, 4, 7).await; // lecture impossible
    sqlx::query("INSERT INTO messages_corps_index (message_ref, cabinet_id, compte_id, tsv) VALUES ($1, $2, $3, to_tsvector('french', 'texte'))")
        .bind(indexe)
        .bind(cabinet)
        .bind(compte)
        .execute(&pool)
        .await
        .expect("index");

    // ===== 1. Sélection : ni indexé, ni d'une UIDVALIDITY périmée =====
    let selection = messages_a_indexer(&pool, compte, 50)
        .await
        .expect("sélection");
    let ids: Vec<Uuid> = selection.iter().map(|l| l.0).collect();
    assert!(ids.contains(&a_lire), "le message à lire est sélectionné");
    assert!(
        ids.contains(&capricieux),
        "le message à retenter est sélectionné"
    );
    assert!(!ids.contains(&indexe), "un message indexé n'est pas relu");
    assert!(
        !ids.contains(&perime),
        "un message d'une UIDVALIDITY périmée n'est pas lu avant sa resynchronisation"
    );

    // ===== 2. Progression : le périmé n'est pas « à venir » =====
    let p = progression(&pool, compte).await.expect("progression");
    assert_eq!(
        (p.indexes, p.restants, p.abandonnes),
        (1, 2, 0),
        "un indexé, deux à venir (le périmé n'est pas compté), aucun abandonné"
    );

    // ===== 3. Tentatives bornées, attente croissante, abandon au cinquième échec =====
    let mut attentes_minutes = Vec::new();
    for essai in 1..=TENTATIVES_MAX {
        noter_echec(&pool, capricieux, compte, "absent", true)
            .await
            .expect("échec noté");
        let (tentatives, attente): (i32, f64) = sqlx::query_as(
            "SELECT tentatives, (EXTRACT(EPOCH FROM (prochaine_le - NOW())) / 60)::float8 FROM messages_corps_echecs WHERE message_ref = $1",
        )
        .bind(capricieux)
        .fetch_one(&pool)
        .await
        .expect("échec lu");
        assert_eq!(
            tentatives, essai,
            "une tentative de plus à chaque échec compté"
        );
        attentes_minutes.push(attente);
        // Tant que l'attente court, le message n'est pas sélectionné ; il l'est de nouveau quand elle est écoulée.
        let pendant = messages_a_indexer(&pool, compte, 50)
            .await
            .expect("sélection");
        assert!(
            !pendant.iter().any(|l| l.0 == capricieux),
            "le message est écarté pendant son attente (essai {essai})"
        );
        if essai < TENTATIVES_MAX {
            sqlx::query("UPDATE messages_corps_echecs SET prochaine_le = NOW() - INTERVAL '1 minute' WHERE message_ref = $1")
                .bind(capricieux)
                .execute(&pool)
                .await
                .expect("attente écoulée");
            let apres = messages_a_indexer(&pool, compte, 50)
                .await
                .expect("sélection");
            assert!(
                apres.iter().any(|l| l.0 == capricieux),
                "essai négatif : l'attente écoulée, le message est retenté (essai {essai})"
            );
        }
    }
    // Attentes constatées : 2, 10, 60, 360, 360 minutes (à la minute près), jamais décroissantes.
    for (constatee, attendue) in attentes_minutes
        .iter()
        .zip([2.0_f64, 10.0, 60.0, 360.0, 360.0])
    {
        assert!(
            (*constatee - attendue).abs() < 1.0,
            "attente constatée {constatee} min, attendue {attendue} min"
        );
    }
    // Au cinquième échec même une attente écoulée ne le ramène pas : il est abandonné.
    sqlx::query("UPDATE messages_corps_echecs SET prochaine_le = NOW() - INTERVAL '1 minute' WHERE message_ref = $1")
        .bind(capricieux)
        .execute(&pool)
        .await
        .expect("attente écoulée");
    let selection = messages_a_indexer(&pool, compte, 50)
        .await
        .expect("sélection");
    assert!(
        !selection.iter().any(|l| l.0 == capricieux),
        "un message abandonné n'est plus jamais sélectionné"
    );
    let p = progression(&pool, compte).await.expect("progression");
    assert_eq!(
        (p.indexes, p.restants, p.abandonnes),
        (1, 1, 1),
        "un indexé, un à venir, un abandonné compté"
    );

    // ===== 4. L'échec « UIDVALIDITY » ne compte pas comme un essai =====
    noter_echec(&pool, a_lire, compte, "uidvalidity", false)
        .await
        .expect("échec noté");
    let (tentatives,): (i32,) =
        sqlx::query_as("SELECT tentatives FROM messages_corps_echecs WHERE message_ref = $1")
            .bind(a_lire)
            .fetch_one(&pool)
            .await
            .expect("échec lu");
    assert_eq!(tentatives, 0, "un repoussé n'est pas un essai");

    // ===== 5. La progression finit par « terminée » : plus rien à venir =====
    // La lecture réussit (message indexé), puis la relève resynchronise le message périmé (nouvelle UIDVALIDITY) et il
    // est indexé à son tour.
    for id in [a_lire] {
        sqlx::query("INSERT INTO messages_corps_index (message_ref, cabinet_id, compte_id, tsv) VALUES ($1, $2, $3, to_tsvector('french', 'texte')) ON CONFLICT DO NOTHING")
            .bind(id)
            .bind(cabinet)
            .bind(compte)
            .execute(&pool)
            .await
            .expect("index");
    }
    let p = progression(&pool, compte).await.expect("progression");
    assert_eq!(
        p.restants, 0,
        "le périmé n'est pas « à venir » : la progression est terminée"
    );
    assert_eq!((p.indexes, p.abandonnes), (2, 1));
    // Essai négatif : le message périmé, une fois resynchronisé (UIDVALIDITY du dossier), redevient « à venir ».
    sqlx::query("UPDATE messages SET uid_validity = 7 WHERE id = $1")
        .bind(perime)
        .execute(&pool)
        .await
        .expect("resynchronisation");
    let p = progression(&pool, compte).await.expect("progression");
    assert_eq!(
        p.restants, 1,
        "resynchronisé, le message reprend sa place dans les « à venir »"
    );
    let selection = messages_a_indexer(&pool, compte, 50)
        .await
        .expect("sélection");
    assert!(
        selection.iter().any(|l| l.0 == perime),
        "resynchronisé, le message est sélectionné"
    );
}
