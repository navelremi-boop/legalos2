//! Une base neuve, migrations seules, ne contient aucun compte.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::{SystemTime, UNIX_EPOCH};

#[tokio::test]
async fn instance_neuve_migrations_seules_sans_compte() {
    let _ = dotenvy::dotenv();
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL requis (Postgres réel, ex. instance S1)");
    let admin_url = url_base_postgres(&database_url);
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_url)
        .await
        .expect("connexion postgres");
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("horloge")
        .as_nanos();
    let name = format!("legalos_vierge_{suffix}");
    sqlx::query(&format!("CREATE DATABASE \"{name}\""))
        .execute(&admin)
        .await
        .expect("create database");
    let vierge = remplacer_base(&database_url, &name);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&vierge)
        .await
        .expect("connexion base vierge");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrations");
    let comptes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM utilisateurs")
        .fetch_one(&pool)
        .await
        .expect("compte");
    pool.close().await;
    sqlx::query(&format!("DROP DATABASE \"{name}\""))
        .execute(&admin)
        .await
        .expect("drop database");
    assert_eq!(comptes, 0, "migrations seules : aucun compte");
}

fn url_base_postgres(database_url: &str) -> String {
    remplacer_base(database_url, "postgres")
}

fn remplacer_base(database_url: &str, base: &str) -> String {
    let (head, _) = database_url
        .rsplit_once('/')
        .expect("DATABASE_URL sans nom de base");
    let head = head.split('?').next().expect("url");
    format!("{head}/{base}")
}
