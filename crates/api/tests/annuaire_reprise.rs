//! Reprise des parties : 3 000 dossiers, idempotente, aucune partie perdue.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use legalos_api::config::Config;
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
async fn reprise_de_trois_mille_dossiers_est_idempotente() {
    ensure_test_env();
    let mut config = Config::from_env().expect("DATABASE_URL requis");
    // Sous Windows, « localhost » peut rester sur IPv6 et le pool expire.
    config.database_url = config.database_url.replace("@localhost:", "@127.0.0.1:");
    let pool = legalos_api::db::connect_pool(&config.database_url)
        .await
        .expect("connexion Postgres");
    legalos_api::db::appliquer_migrations(&pool)
        .await
        .expect("migrations");

    let mut tx = pool.begin().await.expect("transaction");
    let cabinet = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Cabinet reprise', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("reprise-{cabinet}"))
    .execute(&mut *tx)
    .await
    .expect("cabinet");

    sqlx::query(
        r#"
        INSERT INTO dossiers (id, cabinet_id, nom, chemise, juridiction, numero_rg, visibilite)
        SELECT gen_random_uuid(), $1, 'Dossier ' || i, 'kraft', 'TJ fictif', i::text, 'public'
        FROM generate_series(1, 3000) AS i
        "#,
    )
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("dossiers");

    sqlx::query(
        r#"
        INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, visibilite)
        SELECT gen_random_uuid(), d.id, d.cabinet_id, 'client',
            CASE
                WHEN d.n % 60 = 0 THEN 'SARL Duclos'
                WHEN d.n % 60 = 1 THEN 'sarl   duclos'
                WHEN d.n % 60 = 2 THEN 'Association Les Tilleuls'
                ELSE 'Client ' || d.n
            END,
            'public'
        FROM (
            SELECT id, cabinet_id, row_number() OVER (ORDER BY numero_rg) AS n
            FROM dossiers
            WHERE cabinet_id = $1
        ) AS d
        "#,
    )
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("clients");

    let contact_jean = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO contacts (id, cabinet_id, nature, nom, type_client, a_completer, revision)
        VALUES ($1, $2, 'physique', 'Jean Martin', 'particulier', FALSE, 1)
        "#,
    )
    .bind(contact_jean)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("contact jean");

    sqlx::query(
        r#"
        INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, contact_id, visibilite)
        SELECT gen_random_uuid(), id, cabinet_id, 'adversaire', 'jean   martin', $2, 'public'
        FROM dossiers WHERE cabinet_id = $1
        ORDER BY numero_rg LIMIT 1
        "#,
    )
    .bind(cabinet)
    .bind(contact_jean)
    .execute(&mut *tx)
    .await
    .expect("adversaire");

    sqlx::query(
        r#"
        INSERT INTO parties (id, dossier_id, cabinet_id, role, nom, visibilite)
        SELECT gen_random_uuid(), id, cabinet_id, 'confrere', 'Anne Perrin', 'public'
        FROM dossiers WHERE cabinet_id = $1
        ORDER BY numero_rg LIMIT 1
        "#,
    )
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("confrere");

    sqlx::query("SELECT reprendre_parties_intervenants()")
        .execute(&mut *tx)
        .await
        .expect("reprise");

    let parties: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM parties WHERE cabinet_id = $1")
        .bind(cabinet)
        .fetch_one(&mut *tx)
        .await
        .expect("compte parties");
    let intervenants: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dossier_intervenants WHERE cabinet_id = $1 AND partie_id IS NOT NULL",
    )
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("compte intervenants");
    assert_eq!(intervenants, parties, "aucune partie perdue");

    let sans_client: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM dossiers d
        WHERE d.cabinet_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM dossier_intervenants i
            JOIN qualites q ON q.id = i.qualite_id
            WHERE i.dossier_id = d.id AND q.code = 'client'
          )
        "#,
    )
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("dossiers sans client");
    assert_eq!(sans_client, 0);

    let duclos: (i64, String, bool) = sqlx::query_as(
        r#"
        SELECT COUNT(*), MIN(nature), bool_and(a_completer)
        FROM contacts
        WHERE cabinet_id = $1 AND normaliser_nom_contact(nom) = 'sarl duclos'
        "#,
    )
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("fiche duclos");
    assert_eq!(duclos.0, 1);
    assert_eq!(duclos.1, "morale");
    assert!(duclos.2);

    let jean: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM dossier_intervenants
        WHERE cabinet_id = $1 AND contact_id = $2
        "#,
    )
    .bind(cabinet)
    .bind(contact_jean)
    .fetch_one(&mut *tx)
    .await
    .expect("jean repris");
    assert_eq!(jean, 1);

    let avocat: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM dossier_intervenants i
        JOIN qualites q ON q.id = i.qualite_id
        WHERE i.cabinet_id = $1 AND q.code = 'avocat'
        "#,
    )
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("confrere devenu avocat");
    assert_eq!(avocat, 1);

    sqlx::query("SELECT reprendre_parties_intervenants()")
        .execute(&mut *tx)
        .await
        .expect("seconde reprise");
    let encore: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dossier_intervenants WHERE cabinet_id = $1 AND partie_id IS NOT NULL",
    )
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("compte après seconde reprise");
    assert_eq!(encore, intervenants, "deux exécutions, le même résultat");

    tx.rollback().await.expect("annulation du jeu");
}
