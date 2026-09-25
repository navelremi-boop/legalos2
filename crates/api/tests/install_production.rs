//! `cargo xtask install` : production, pas de compte démo, clé connue refusée.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use legalos_api::config::CLES_CHIFFREMENT_CONNUES;
use legalos_api::install::{creer_premier_administrateur, uri_otpauth, EMAIL_ADMIN};

#[tokio::test]
async fn install_demarre_en_production_sans_demo() {
    let _ = dotenvy::dotenv();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let admin_url = url_base_postgres(&database_url);
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_url)
        .await
        .expect("postgres");
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("horloge")
        .as_nanos();
    let name = format!("legalos_install_{suffix}");
    sqlx::query(&format!("CREATE DATABASE \"{name}\""))
        .execute(&admin)
        .await
        .expect("create");
    let vierge = remplacer_base(&database_url, &name);
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&vierge)
        .await
        .expect("vierge");
    let cle_brute = "InstallKeyNotKnown0123456789abcd";
    assert_eq!(cle_brute.len(), 32);
    let mut cle = [0u8; 32];
    cle.copy_from_slice(cle_brute.as_bytes());
    let cree = creer_premier_administrateur(
        &pool,
        &cle,
        "MotDePasseInstalle1",
        "MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO",
    )
    .await
    .expect("install");
    assert_eq!(cree.email, EMAIL_ADMIN);
    assert!(uri_otpauth(&cree.email, &cree.secret_totp_base32).starts_with("otpauth://totp/"));
    let demos: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM utilisateurs WHERE email = 'demo@cabinet-fictif.example'",
    )
    .fetch_one(&pool)
    .await
    .expect("demo");
    assert_eq!(demos, 0);
    pool.close().await;

    let port_ok = 30000 + (suffix % 10000) as u16;
    for (indice, cle_connue) in CLES_CHIFFREMENT_CONNUES.iter().enumerate() {
        let port_refus = 20000 + (suffix % 10000) as u16 + indice as u16;
        let echec = Command::new(env!("CARGO_BIN_EXE_legalos-api"))
            .env("DATABASE_URL", &vierge)
            .env("SECRETS_CHIFFREMENT_KEY", cle_connue)
            .env("API_BIND", format!("127.0.0.1:{port_refus}"))
            .env_remove("LEGALOS_MODE")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("spawn refus");
        assert!(!echec.success(), "clé connue acceptée en production");
    }

    let mut enfant = Command::new(env!("CARGO_BIN_EXE_legalos-api"))
        .env("DATABASE_URL", &vierge)
        .env("SECRETS_CHIFFREMENT_KEY", cle_brute)
        .env("API_BIND", format!("127.0.0.1:{port_ok}"))
        .env_remove("LEGALOS_MODE")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn api");
    let url = format!("http://127.0.0.1:{port_ok}/health");
    let ok = tokio::task::spawn_blocking(move || attendre_sante(&url))
        .await
        .expect("santé");
    let _ = enfant.kill();
    let _ = enfant.wait();
    sqlx::query(&format!("DROP DATABASE \"{name}\" WITH (FORCE)"))
        .execute(&admin)
        .await
        .ok();
    assert!(ok, "l'instance installée ne répond pas en production");
}

fn attendre_sante(url: &str) -> bool {
    let debut = Instant::now();
    while debut.elapsed() < Duration::from_secs(20) {
        if let Ok(reponse) = reqwest::blocking::get(url) {
            if reponse.status().is_success() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
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
