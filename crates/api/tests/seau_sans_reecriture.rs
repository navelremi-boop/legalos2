//! Une réécriture identique ne modifie pas la ligne : sinon Postgres publie une mise à jour et
//! PowerSync en fait une opération de seau, même si les valeurs synchronisées n'ont pas changé.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::{SystemTime, UNIX_EPOCH};

use legalos_api::moteur_mail::{poser_etat_connexion, poser_serveur_indisponible};
use uuid::Uuid;

#[tokio::test]
async fn seau_sans_reecriture() {
    let _ = dotenvy::dotenv();
    if std::env::var("DATABASE_URL").is_err() {
        let _ = dotenvy::from_filename("../../.env");
    }
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL requis (Postgres réel)");
    let admin_url = remplacer_base(&database_url, "postgres");
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_url)
        .await
        .expect("connexion postgres");
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("horloge")
        .as_nanos();
    let name = format!("legalos_seau_{suffix}");
    sqlx::query(&format!("CREATE DATABASE \"{name}\""))
        .execute(&admin)
        .await
        .expect("create database");
    let url = remplacer_base(&database_url, &name);
    let resultat = essai(&url).await;
    sqlx::query(&format!("DROP DATABASE \"{name}\" WITH (FORCE)"))
        .execute(&admin)
        .await
        .expect("drop database");
    resultat.expect("réécriture identique");
}

async fn essai(url: &str) -> Result<(), String> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(url)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let cabinet = Uuid::now_v7();
    let utilisateur = Uuid::now_v7();
    let compte = Uuid::now_v7();
    sqlx::query("INSERT INTO cabinets (id, slug, nom) VALUES ($1, $2, 'Cabinet fictif')")
        .bind(cabinet)
        .bind(format!("seau-{compte}"))
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO utilisateurs (id, cabinet_id, email, password_hash) VALUES ($1, $2, $3, 'x')",
    )
    .bind(utilisateur)
    .bind(cabinet)
    .bind(format!("seau-{compte}@cabinet.example"))
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)
         VALUES ($1, $2, 'nominatif', $3, $4, 'secret')",
    )
    .bind(compte)
    .bind(cabinet)
    .bind(utilisateur)
    .bind(format!("boite-{compte}@cabinet.example"))
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let premiere = poser_etat_connexion(&pool, compte, "connecte", None)
        .await
        .map_err(|e| e.to_string())?;
    if premiere != 1 {
        return Err(format!("premier passage : {premiere} ligne, 1 attendue"));
    }
    let version = xmin(&pool, compte).await?;
    let identique = poser_etat_connexion(&pool, compte, "connecte", None)
        .await
        .map_err(|e| e.to_string())?;
    if identique != 0 {
        return Err(format!(
            "réécriture identique : {identique} ligne, 0 attendue"
        ));
    }
    let version_apres = xmin(&pool, compte).await?;
    if version_apres != version {
        return Err(format!(
            "la version de ligne a changé ({version} → {version_apres})"
        ));
    }

    let empreinte = poser_etat_connexion(&pool, compte, "connecte", Some("hote|143|capa|secret"))
        .await
        .map_err(|e| e.to_string())?;
    if empreinte != 1 {
        return Err(format!(
            "empreinte nouvelle : {empreinte} ligne, 1 attendue"
        ));
    }
    let empreinte_identique =
        poser_etat_connexion(&pool, compte, "connecte", Some("hote|143|capa|secret"))
            .await
            .map_err(|e| e.to_string())?;
    if empreinte_identique != 0 {
        return Err(format!(
            "empreinte identique : {empreinte_identique} ligne, 0 attendue"
        ));
    }

    let panne = poser_serveur_indisponible(&pool, compte)
        .await
        .map_err(|e| e.to_string())?;
    if panne != 1 {
        return Err(format!("serveur indisponible : {panne} ligne, 1 attendue"));
    }
    let panne_identique = poser_serveur_indisponible(&pool, compte)
        .await
        .map_err(|e| e.to_string())?;
    if panne_identique != 0 {
        return Err(format!(
            "indisponible déjà posé : {panne_identique} ligne, 0 attendue"
        ));
    }
    // La relève réussie retire l'indicateur, même si l'état de connexion est déjà « connecte ».
    let releve = poser_etat_connexion(&pool, compte, "connecte", Some("hote|143|capa|secret"))
        .await
        .map_err(|e| e.to_string())?;
    if releve != 1 {
        return Err(format!(
            "retrait de l'indicateur : {releve} ligne, 1 attendue"
        ));
    }
    let releve_identique =
        poser_etat_connexion(&pool, compte, "connecte", Some("hote|143|capa|secret"))
            .await
            .map_err(|e| e.to_string())?;
    if releve_identique != 0 {
        return Err(format!(
            "relève identique : {releve_identique} ligne, 0 attendue"
        ));
    }
    Ok(())
}

async fn xmin(pool: &sqlx::PgPool, compte: Uuid) -> Result<String, String> {
    sqlx::query_scalar("SELECT xmin::text::bigint::text FROM comptes_mail WHERE id = $1")
        .bind(compte)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

fn remplacer_base(database_url: &str, base: &str) -> String {
    let (tete, _) = database_url
        .rsplit_once('/')
        .expect("DATABASE_URL sans nom de base");
    let tete = tete.split('?').next().expect("url");
    format!("{tete}/{base}")
}
