//! Poste B sans accès : la fiche du cabinet est là, le dossier restreint non.
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
async fn le_poste_b_voit_la_fiche_et_pas_le_dossier_restreint() {
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
    let user_a = Uuid::now_v7();
    let user_b = Uuid::now_v7();
    let dossier = Uuid::now_v7();
    let contact = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO cabinets (id, slug, nom, totp_obligatoire) VALUES ($1, $2, 'Cabinet droits', TRUE)",
    )
    .bind(cabinet)
    .bind(format!("droits-{cabinet}"))
    .execute(&mut *tx)
    .await
    .expect("cabinet");
    for (id, mail) in [(user_a, "a"), (user_b, "b")] {
        sqlx::query(
            "INSERT INTO utilisateurs (id, cabinet_id, email, password_hash) VALUES ($1, $2, $3, 'x')",
        )
        .bind(id)
        .bind(cabinet)
        .bind(format!("droits-{mail}-{id}@example.test"))
        .execute(&mut *tx)
        .await
        .expect("utilisateur");
    }
    sqlx::query(
        "INSERT INTO dossiers (id, cabinet_id, nom, chemise, juridiction, numero_rg, visibilite, restreint) VALUES ($1, $2, 'Dossier secret', 'kraft', 'TJ fictif', $3, 'restreint', TRUE)",
    )
    .bind(dossier)
    .bind(cabinet)
    .bind(format!("rg-{dossier}"))
    .execute(&mut *tx)
    .await
    .expect("dossier");
    sqlx::query(
        "INSERT INTO dossier_acces (dossier_id, utilisateur_id, utilisateur_texte, dossier_texte) VALUES ($1, $2, $3, $4)",
    )
    .bind(dossier)
    .bind(user_a)
    .bind(user_a.to_string())
    .bind(dossier.to_string())
    .execute(&mut *tx)
    .await
    .expect("accès");
    sqlx::query(
        "INSERT INTO contacts (id, cabinet_id, nature, nom, type_client) VALUES ($1, $2, 'morale', 'Société visible', 'professionnel')",
    )
    .bind(contact)
    .bind(cabinet)
    .execute(&mut *tx)
    .await
    .expect("contact");
    let qualite = sqlx::query_scalar::<_, Uuid>("SELECT id FROM qualites WHERE cabinet_id = $1 LIMIT 1")
        .bind(cabinet)
        .fetch_one(&mut *tx)
        .await
        .expect("qualité");
    let intervenant = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO dossier_intervenants (id, cabinet_id, dossier_id, contact_id, qualite_id, visibilite) VALUES ($1, $2, $3, $4, $5, 'public')",
    )
    .bind(intervenant)
    .bind(cabinet)
    .bind(dossier)
    .bind(contact)
    .bind(qualite)
    .execute(&mut *tx)
    .await
    .expect("intervenant");

    let fiche = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM contacts WHERE cabinet_id = $1 AND id = $2",
    )
    .bind(cabinet)
    .bind(contact)
    .fetch_one(&mut *tx)
    .await
    .expect("fiche cabinet");
    assert_eq!(fiche, 1, "l'annuaire du cabinet contient la fiche");

    let publics = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM dossier_intervenants WHERE visibilite = 'public' AND cabinet_id = $1 AND id = $2",
    )
    .bind(cabinet)
    .bind(intervenant)
    .fetch_one(&mut *tx)
    .await
    .expect("publics");
    assert_eq!(publics, 0, "le flux public n'emporte pas l'intervenant");

    let chez_b = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM dossier_intervenants
        INNER JOIN groupe_acces_membres ON dossier_intervenants.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND dossier_intervenants.id = $2
        "#,
    )
    .bind(user_b.to_string())
    .bind(intervenant)
    .fetch_one(&mut *tx)
    .await
    .expect("poste B");
    assert_eq!(chez_b, 0, "le poste B n'a pas le dossier restreint");

    let chez_a = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT count(*) FROM dossier_intervenants
        INNER JOIN groupe_acces_membres ON dossier_intervenants.groupe_acces = groupe_acces_membres.groupe_id
        WHERE groupe_acces_membres.utilisateur_texte = $1 AND dossier_intervenants.id = $2
        "#,
    )
    .bind(user_a.to_string())
    .bind(intervenant)
    .fetch_one(&mut *tx)
    .await
    .expect("poste A");
    assert_eq!(chez_a, 1, "le poste A, membre du groupe, a l'intervenant");

    tx.rollback().await.expect("annulation");
}
