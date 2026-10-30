//! Import par SIREN : les champs non retenus restent, la source et la date sont écrites.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use legalos_api::config::Config;
use legalos_api::recherche_entreprises::{enregistrer_import, poser_marque, retenir_champs};
use uuid::Uuid;

fn ensure_test_env() {
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

#[tokio::test]
async fn un_import_retient_les_champs_coches_et_consigne_la_source() {
    ensure_test_env();
    let mut config = Config::from_env().expect("DATABASE_URL requis");
    config.database_url = config.database_url.replace("@localhost:", "@127.0.0.1:");
    let pool = legalos_api::db::connect_pool(&config.database_url)
        .await
        .expect("connexion Postgres");
    legalos_api::db::appliquer_migrations(&pool)
        .await
        .expect("migrations");

    let mut tx = pool.begin().await.expect("transaction");
    let cabinet = Uuid::now_v7();
    let contact = Uuid::now_v7();
    let cree = Uuid::now_v7();
    let adresse = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Cabinet import', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("import-{cabinet}"))
    .execute(&mut *tx)
    .await
    .expect("cabinet");
    sqlx::query(
        r#"
        INSERT INTO contacts (
            id, cabinet_id, nature, nom, type_client, forme, capital_centimes, greffe_rcs
        )
        VALUES ($1, $2, 'morale', 'Ancien nom', 'professionnel', 'ancienne forme', 1000000, 'RCS de Lyon')
        "#,
    )
    .bind(contact)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("contact");

    let (champs, id_adresse) = retenir_champs(
        Some("DUCLOS INDUSTRIE".into()),
        None,
        Some("25.11Z".into()),
        Some("8 QUAI SAINT-VINCENT 69001 LYON".into()),
        Some(adresse),
    )
    .expect("champs");
    enregistrer_import(&mut tx, cabinet, contact, id_adresse, &champs)
        .await
        .expect("import");

    let ligne = sqlx::query_as::<
        _,
        (
            String,
            String,
            Option<String>,
            i64,
            String,
            Option<String>,
            Option<String>,
        ),
    >(
        r#"
        SELECT nom, forme, activite, capital_centimes, greffe_rcs, source_import, importe_le::text
        FROM contacts WHERE id = $1
        "#,
    )
    .bind(contact)
    .fetch_one(&mut *tx)
    .await
    .expect("lecture");
    assert_eq!(ligne.0, "DUCLOS INDUSTRIE");
    assert_eq!(ligne.1, "ancienne forme");
    assert_eq!(ligne.2.as_deref(), Some("25.11Z"));
    assert_eq!(ligne.3, 1_000_000);
    assert_eq!(ligne.4, "RCS de Lyon");
    assert_eq!(ligne.5.as_deref(), Some("recherche-entreprises"));
    assert!(ligne.6.is_some());

    let siege = sqlx::query_as::<_, (String, String, bool)>(
        "SELECT usage, valeur, principale FROM contact_coordonnees WHERE contact_id = $1",
    )
    .bind(contact)
    .fetch_one(&mut *tx)
    .await
    .expect("siège");
    assert_eq!(siege.0, "siege");
    assert_eq!(siege.1, "8 QUAI SAINT-VINCENT 69001 LYON");
    assert!(siege.2);

    sqlx::query(
        r#"
        INSERT INTO contacts (id, cabinet_id, nature, nom, type_client)
        VALUES ($1, $2, 'morale', 'Nouvelle société', 'professionnel')
        "#,
    )
    .bind(cree)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("création");
    poser_marque(&mut tx, cree).await.expect("marque");
    let marque = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT source_import, importe_le::text FROM contacts WHERE id = $1",
    )
    .bind(cree)
    .fetch_one(&mut *tx)
    .await
    .expect("lecture création");
    assert_eq!(marque.0.as_deref(), Some("recherche-entreprises"));
    assert!(marque.1.is_some());

    tx.rollback().await.expect("annulation");
}
