//! `cargo xtask install` : production, pas de compte démo, clé connue refusée.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use legalos_api::config::{mot_de_passe_dans_url, valeur_secrete_publiee, SECRETS_PUBLIES};
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
    let mut noms_vus = std::collections::BTreeSet::new();
    for (indice, (nom, valeur)) in SECRETS_PUBLIES.iter().enumerate() {
        if !noms_vus.insert(*nom) && *nom != "SECRETS_CHIFFREMENT_KEY" {
            continue;
        }
        let port_refus = 20000 + (suffix % 10000) as u16 + indice as u16;
        let mut commande = Command::new(env!("CARGO_BIN_EXE_legalos-api"));
        isoler_secrets(&mut commande);
        commande
            .env(
                "DATABASE_URL",
                "postgresql://legalos:motdepasse-non-publie@127.0.0.1:1/aucune",
            )
            .env("SECRETS_CHIFFREMENT_KEY", cle_brute)
            .env(nom, valeur)
            .env("API_BIND", format!("127.0.0.1:{port_refus}"))
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let echec = commande.status().expect("spawn refus");
        assert!(!echec.success(), "{nom} publié accepté en production");
    }

    let mot_url_publie = mot_de_passe_dans_url(&vierge)
        .is_some_and(|mot| valeur_secrete_publiee("POSTGRES_PASSWORD", mot))
        || valeur_secrete_publiee("DATABASE_URL", &vierge);
    let mut enfant_cmd = Command::new(env!("CARGO_BIN_EXE_legalos-api"));
    isoler_secrets(&mut enfant_cmd);
    enfant_cmd
        .env("DATABASE_URL", &vierge)
        .env("SECRETS_CHIFFREMENT_KEY", cle_brute)
        .env("API_BIND", format!("127.0.0.1:{port_ok}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if mot_url_publie {
        let echec = enfant_cmd.status().expect("spawn url publiée");
        assert!(
            !echec.success(),
            "DATABASE_URL au mot de passe publié acceptée en production"
        );
        sqlx::query(&format!("DROP DATABASE \"{name}\" WITH (FORCE)"))
            .execute(&admin)
            .await
            .ok();
        return;
    }
    let mut enfant = enfant_cmd.spawn().expect("spawn api");
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

fn isoler_secrets(commande: &mut Command) {
    commande.env_remove("LEGALOS_MODE");
    let mut noms = std::collections::BTreeSet::new();
    for (nom, _) in SECRETS_PUBLIES {
        noms.insert(*nom);
    }
    for nom in noms {
        commande.env_remove(nom);
    }
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
