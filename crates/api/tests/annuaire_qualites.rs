//! Une qualité utilisée s'archive ; une qualité seule est retirée.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use legalos_api::config::Config;
use legalos_api::routes::qualites::{appliquer_retrait_qualite, valider_code_qualite};
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
async fn une_qualite_utilisee_s_archive_une_qualite_seule_est_retiree() {
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
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Cabinet qualités', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("qual-{cabinet}"))
    .execute(&mut *tx)
    .await
    .expect("cabinet");
    assert!(valider_code_qualite("expert_partie").is_ok());
    assert!(valider_code_qualite("Expert").is_err());

    let utilisee = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM qualites WHERE cabinet_id = $1 AND code = 'avocat'",
    )
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("avocat");
    let seule = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM qualites WHERE cabinet_id = $1 AND code = 'apporteur_affaires'",
    )
    .bind(cabinet)
    .fetch_one(&mut *tx)
    .await
    .expect("apporteur");

    let dossier = Uuid::now_v7();
    let contact = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO dossiers (id, cabinet_id, nom, chemise, juridiction, numero_rg, visibilite) VALUES ($1, $2, 'Dossier', 'kraft', 'TJ fictif', $3, 'public')",
    )
    .bind(dossier)
    .bind(cabinet)
    .bind(format!("rg-{dossier}"))
    .execute(&mut *tx)
    .await
    .expect("dossier");
    sqlx::query(
        "INSERT INTO contacts (id, cabinet_id, nature, nom, type_client) VALUES ($1, $2, 'physique', 'Conseil', 'particulier')",
    )
    .bind(contact)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("contact");
    sqlx::query(
        "INSERT INTO dossier_intervenants (id, cabinet_id, dossier_id, contact_id, qualite_id, visibilite) VALUES ($1, $2, $3, $4, $5, 'public')",
    )
    .bind(Uuid::now_v7())
    .bind(cabinet)
    .bind(dossier)
    .bind(contact)
    .bind(utilisee)
    .execute(&mut *tx)
    .await
    .expect("intervenant");

    assert_eq!(
        appliquer_retrait_qualite(&mut tx, cabinet, utilisee)
            .await
            .expect("retrait utilisé"),
        "archive"
    );
    assert_eq!(
        appliquer_retrait_qualite(&mut tx, cabinet, utilisee)
            .await
            .expect("second retrait"),
        "archive"
    );
    let reste = sqlx::query_scalar::<_, bool>("SELECT archivee FROM qualites WHERE id = $1")
        .bind(utilisee)
        .fetch_one(&mut *tx)
        .await
        .expect("archivée");
    assert!(reste);

    assert_eq!(
        appliquer_retrait_qualite(&mut tx, cabinet, seule)
            .await
            .expect("retrait seul"),
        "supprime"
    );
    let absente = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM qualites WHERE id = $1")
        .bind(seule)
        .fetch_one(&mut *tx)
        .await
        .expect("compte");
    assert_eq!(absente, 0);

    tx.rollback().await.expect("annulation");
}
